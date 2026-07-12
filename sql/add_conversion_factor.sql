-- Ejecutar en psql/pgAdmin como superuser
-- Schemas: core, operations
--
-- Agrega soporte para productos que se cuentan en unidades físicas discretas
-- pero se almacenan/pesan en otra unidad base (ej: aceitunas, quesos, fiambres:
-- 1 unidad = 7.5 KG). conversion_factor queda NULL para todo lo que no aplique
-- (la mayoría del catálogo) — no hay forma de derivarlo automáticamente de los
-- datos existentes, así que se completa a mano, producto por producto.
--
-- También crea operations.update_stock(), que hoy NO EXISTE en la base aunque
-- ya está siendo llamada por operations.confirm_production() y
-- operations.consume_recipe_ingredients() (esas dos funciones fallarían con
-- "function operations.update_stock does not exist" si se ejecutaran hoy).
-- De paso corrige esas dos funciones: usaban 'PRODUCTION'/'CONSUMPTION' como
-- movement_type, pero el enum real es en español (PRODUCCION, CONSUMO, ...).

-- ── 1. Columnas nuevas ──────────────────────────────────────────────────────

ALTER TABLE core.products
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(10, 3)
    CONSTRAINT products_conversion_factor_positive
    CHECK (conversion_factor IS NULL OR conversion_factor > 0);

COMMENT ON COLUMN core.products.conversion_factor IS
  'Cuántos KG (o base_unit) equivalen a 1 unidad física. NULL = el producto no se cuenta por unidades.';

ALTER TABLE operations.stock
  ADD COLUMN IF NOT EXISTS quantity_units NUMERIC(10, 3)
    CONSTRAINT stock_quantity_units_positive
    CHECK (quantity_units IS NULL OR quantity_units >= 0);

COMMENT ON COLUMN operations.stock.quantity_units IS
  'quantity / conversion_factor del producto, sin redondear. NULL si el producto no tiene conversion_factor.';

ALTER TABLE operations.stock_movements
  ADD COLUMN IF NOT EXISTS quantity_units NUMERIC(10, 3);

COMMENT ON COLUMN operations.stock_movements.quantity_units IS
  'Delta en unidades físicas del movimiento (valor absoluto). NULL si el producto no tiene conversion_factor.';

-- ── 2. Vista del Dashboard: se agrega la columna al final ───────────────────
-- (CREATE OR REPLACE VIEW no permite reordenar ni quitar columnas existentes)

CREATE OR REPLACE VIEW operations.recent_stock_movements AS
SELECT
  sm.created_at,
  s.name              AS sector,
  p.official_name     AS producto,
  sm.movement_type     AS tipo_movimiento,
  sm.quantity          AS cantidad,
  sm.unit              AS unidad,
  sm.stock_before      AS stock_antes,
  sm.stock_after       AS stock_despues,
  sm.created_by        AS usuario,
  sm.quantity_units     AS cantidad_unidades
FROM operations.stock_movements sm
JOIN core.sectors  s ON s.id = sm.sector_id
JOIN core.products p ON p.id = sm.product_id
ORDER BY sm.created_at DESC;

-- ── 3. operations.update_stock() — punto único de escritura sobre operations.stock ──
-- p_quantity_delta es la variación de stock (positivo = entra, negativo = sale).
-- Calcula quantity_units automáticamente si el producto tiene conversion_factor,
-- y deja auditoría completa (antes/después, en KG y en unidades) en stock_movements.

CREATE OR REPLACE FUNCTION operations.update_stock(
  p_sector_id      INTEGER,
  p_product_id     UUID,
  p_quantity_delta NUMERIC,
  p_movement_type  operations.movement_type,
  p_reference_id   UUID,
  p_reference_type VARCHAR,
  p_created_by     VARCHAR,
  p_notes          TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_unit         VARCHAR;
  v_conversion   NUMERIC;
  v_stock_before NUMERIC;
  v_stock_after  NUMERIC;
  v_units_after  NUMERIC;
BEGIN
  SELECT base_unit, conversion_factor
    INTO v_unit, v_conversion
    FROM core.products
    WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto % no encontrado', p_product_id;
  END IF;

  SELECT quantity INTO v_stock_before
    FROM operations.stock
    WHERE sector_id = p_sector_id AND product_id = p_product_id
    FOR UPDATE;

  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity_delta;

  IF v_conversion IS NOT NULL THEN
    v_units_after := v_stock_after / v_conversion;
  ELSE
    v_units_after := NULL;
  END IF;

  INSERT INTO operations.stock (
    sector_id, product_id, quantity, quantity_units, unit, last_movement_type, last_updated
  ) VALUES (
    p_sector_id, p_product_id, v_stock_after, v_units_after, v_unit, p_movement_type::text, NOW()
  )
  ON CONFLICT (sector_id, product_id) DO UPDATE SET
    quantity           = v_stock_after,
    quantity_units     = v_units_after,
    unit               = v_unit,
    last_movement_type = p_movement_type::text,
    last_updated       = NOW();

  INSERT INTO operations.stock_movements (
    sector_id, product_id, movement_type, quantity, quantity_units, unit,
    stock_before, stock_after, reference_id, reference_type, created_by, notes
  ) VALUES (
    p_sector_id, p_product_id, p_movement_type, ABS(p_quantity_delta),
    CASE WHEN v_conversion IS NOT NULL THEN ABS(p_quantity_delta) / v_conversion ELSE NULL END,
    v_unit, v_stock_before, v_stock_after, p_reference_id, p_reference_type, p_created_by, p_notes
  );
END;
$function$;

COMMENT ON FUNCTION operations.update_stock IS
  'Punto único de escritura para operations.stock: aplica el delta, recalcula quantity_units cuando el producto tiene conversion_factor, y deja auditoría en stock_movements.';

-- ── 4. Fix: confirm_production() y consume_recipe_ingredients() usaban ─────
-- movement_type en inglés ('PRODUCTION'/'CONSUMPTION'), que no existe en el
-- enum operations.movement_type (los valores reales son PRODUCCION/CONSUMO).
-- Sin este fix, ambas fallarían igual aunque update_stock() ya exista.

CREATE OR REPLACE FUNCTION operations.confirm_production(p_order_id uuid, p_confirmed_quantities jsonb, p_confirmed_by character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_confirmation JSONB;
    v_item_id UUID;
    v_produced_qty DECIMAL;
    v_is_kitchen_product BOOLEAN;
BEGIN
    SELECT * INTO v_order
    FROM operations.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orden % no encontrada', p_order_id;
    END IF;

    IF v_order.status NOT IN ('IN_PRODUCTION', 'PENDING_CONFIRMATION') THEN
        RAISE EXCEPTION 'La orden % no está en producción', p_order_id;
    END IF;

    FOR v_confirmation IN SELECT * FROM jsonb_array_elements(p_confirmed_quantities)
    LOOP
        v_item_id := (v_confirmation->>'item_id')::UUID;
        v_produced_qty := (v_confirmation->>'produced_quantity')::DECIMAL;

        SELECT oi.*, p.is_produced_in_kitchen
        INTO v_item
        FROM operations.order_items oi
        JOIN core.products p ON p.id = oi.product_id
        WHERE oi.id = v_item_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item % no encontrado', v_item_id;
        END IF;

        -- LOGICA HIBRIDA
        IF v_item.is_produced_in_kitchen THEN
            -- Producto de cocina: consumir ingredientes + sumar producto final
            RAISE NOTICE 'Producto de cocina: consumiendo ingredientes para %', v_item.product_id;

            PERFORM operations.consume_recipe_ingredients(
                v_item.product_id,
                v_produced_qty,
                v_order.to_sector_id
            );

            PERFORM operations.update_stock(
                v_order.to_sector_id,
                v_item.product_id,
                v_produced_qty,
                'PRODUCCION'::operations.movement_type,
                p_order_id,
                'production_order',
                p_confirmed_by,
                'Producción confirmada para orden ' || v_order.order_number
            );
        ELSE
            -- Producto directo: solo restar stock
            RAISE NOTICE 'Producto directo: restando stock para %', v_item.product_id;

            PERFORM operations.update_stock(
                v_order.to_sector_id,
                v_item.product_id,
                -v_produced_qty,
                'CONSUMO'::operations.movement_type,
                p_order_id,
                'production_order',
                p_confirmed_by,
                'Stock consumido para orden ' || v_order.order_number
            );
        END IF;

        UPDATE operations.order_items
        SET
            produced_quantity = v_produced_qty,
            confirmed_quantity = v_produced_qty,
            item_status = 'READY_FOR_PICKUP',
            production_completed_at = NOW(),
            confirmed_at = NOW(),
            confirmed_by = p_confirmed_by
        WHERE id = v_item_id;

    END LOOP;

    -- Actualizar estado general de la orden
    IF NOT EXISTS (
        SELECT 1 FROM operations.order_items
        WHERE order_id = p_order_id
          AND item_status NOT IN ('READY_FOR_PICKUP', 'DELIVERED')
    ) THEN
        UPDATE operations.orders
        SET status = 'READY_FOR_PICKUP', completed_at = NOW()
        WHERE id = p_order_id;
    ELSE
        UPDATE operations.orders
        SET status = 'CONFIRMED_PARTIAL'
        WHERE id = p_order_id;
    END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION operations.consume_recipe_ingredients(p_product_id uuid, p_quantity numeric, p_sector_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_recipe_id UUID;
    v_ingredient RECORD;
BEGIN
    SELECT id INTO v_recipe_id
    FROM core.recipes
    WHERE product_id = p_product_id
      AND is_active = TRUE
    LIMIT 1;

    IF v_recipe_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró receta activa para el producto %',
            (SELECT official_name FROM core.products WHERE id = p_product_id);
    END IF;

    FOR v_ingredient IN
        SELECT * FROM core.calculate_ingredients_needed(p_product_id, p_quantity)
    LOOP
        RAISE NOTICE 'Consumiendo ingrediente: % - Cantidad: %',
            v_ingredient.ingredient_name, v_ingredient.quantity_needed;

        PERFORM operations.update_stock(
            p_sector_id,
            v_ingredient.ingredient_id,
            -v_ingredient.quantity_needed,
            'CONSUMO'::operations.movement_type,
            NULL,
            'recipe_consumption',
            NULL,
            'Consumido para producción de ' ||
                (SELECT official_name FROM core.products WHERE id = p_product_id)
        );
    END LOOP;
END;
$function$;
