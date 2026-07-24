-- Ejecutar en psql/pgAdmin como superuser
-- Schema: operations
--
-- operations.update_stock() hoy solo puede calcular quantity_units cuando el
-- producto tiene core.products.conversion_factor cargado. Pero en la pantalla
-- de conteo de stock (app/stock/page.jsx) existe también un conversor ad-hoc
-- (⇄) donde el usuario tipea "cantidad de envases" + "peso por envase" sin que
-- ese peso esté registrado como conversion_factor oficial del producto. En ese
-- caso la cantidad de envases se perdía: solo se guardaba el KG resultante.
--
-- Este script agrega un parámetro opcional p_units_override — cuando se pasa,
-- pisa el cálculo automático y usa ese valor directo como quantity_units.
-- Todos los llamadores existentes (confirm_production, consume_recipe_ingredients,
-- el conteo de stock sin conversor activo) NO pasan este parámetro nuevo →
-- comportamiento idéntico al de antes (DEFAULT NULL = auto-cálculo por conversion_factor).

-- Postgres trata una función con distinta cantidad de parámetros como un
-- OVERLOAD nuevo, no como un reemplazo — así que sin este DROP quedarían dos
-- funciones "update_stock" (8 y 9 args) conviviendo, lo cual vuelve ambiguo
-- cualquier COMMENT ON FUNCTION sin firma completa (y es confuso en general).
DROP FUNCTION IF EXISTS operations.update_stock(
  INTEGER, UUID, NUMERIC, operations.movement_type, UUID, VARCHAR, VARCHAR, TEXT
);

CREATE OR REPLACE FUNCTION operations.update_stock(
  p_sector_id      INTEGER,
  p_product_id     UUID,
  p_quantity_delta NUMERIC,
  p_movement_type  operations.movement_type,
  p_reference_id   UUID,
  p_reference_type VARCHAR,
  p_created_by     VARCHAR,
  p_notes          TEXT DEFAULT NULL,
  p_units_override NUMERIC DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_unit          VARCHAR;
  v_conversion    NUMERIC;
  v_stock_before  NUMERIC;
  v_units_before  NUMERIC;
  v_stock_after   NUMERIC;
  v_units_after   NUMERIC;
BEGIN
  SELECT base_unit, conversion_factor
    INTO v_unit, v_conversion
    FROM core.products
    WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto % no encontrado', p_product_id;
  END IF;

  SELECT quantity, quantity_units INTO v_stock_before, v_units_before
    FROM operations.stock
    WHERE sector_id = p_sector_id AND product_id = p_product_id
    FOR UPDATE;

  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity_delta;

  IF p_units_override IS NOT NULL THEN
    -- Cantidad de unidades contada a mano (con o sin conversion_factor oficial) — se respeta tal cual.
    v_units_after := p_units_override;
  ELSIF v_conversion IS NOT NULL THEN
    v_units_after := v_stock_after / v_conversion;
  ELSE
    -- Ni override ni conversion_factor: no hay forma de saber la cantidad de unidades
    -- para ESTE movimiento puntual. Se preserva la última conocida en vez de borrarla —
    -- pisarla con NULL destruiría un conteo manual anterior por un movimiento que no
    -- trae información de unidades (p.ej. un ajuste de KG directo, sin el conversor).
    v_units_after := v_units_before;
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
    -- Siempre una magnitud de cambio (delta), nunca un total absoluto — trata la
    -- ausencia de quantity_units previo como 0, igual que v_stock_before más arriba,
    -- para que esta columna tenga el mismo significado en todas las filas.
    CASE
      WHEN p_units_override IS NOT NULL THEN ABS(p_units_override - COALESCE(v_units_before, 0))
      WHEN v_conversion IS NOT NULL THEN ABS(p_quantity_delta) / v_conversion
      ELSE NULL
    END,
    v_unit, v_stock_before, v_stock_after, p_reference_id, p_reference_type, p_created_by, p_notes
  );
END;
$function$;

COMMENT ON FUNCTION operations.update_stock IS
  'Punto único de escritura para operations.stock: aplica el delta, calcula quantity_units (por conversion_factor, o por p_units_override si se pasa un conteo manual de unidades), y deja auditoría en stock_movements.';
