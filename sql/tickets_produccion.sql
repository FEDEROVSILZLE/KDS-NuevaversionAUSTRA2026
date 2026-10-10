-- =====================================================================
-- PASO 13: Tickets de producción (tiempos de tarea) + control de olvidos
-- Archivo: sql/tickets_produccion.sql
--
-- Requiere: core.sectors, core.products, core.recipes,
--           operations.order_items, operations.branch_order_items.
-- No depende de audit.order_lifecycle: ese usa el enum order_status y no
-- admite PAUSED / AUTO_CLOSED, así que los tickets tienen su propia bitácora.
-- Corre en una sola transacción: si algo falla, no queda nada a medias.
--
--   psql -U postgres -d kds_production -f sql/tickets_produccion.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------
CREATE TYPE operations.ticket_status AS ENUM (
    'PENDING',       -- en cola, nadie lo empezó
    'IN_PROGRESS',
    'PAUSED',
    'DONE',
    'AUTO_CLOSED',   -- cerrado por el sistema (olvidado). NO confirma producción
    'CANCELLED'
);

CREATE TYPE operations.time_quality AS ENUM (
    'OK',            -- usable para métricas
    'SUSPECT',       -- cerrado tarde (>3x) o demasiado rápido (<0.2x)
    'UNRELIABLE',    -- autocerrado
    'CORRECTED'      -- corregido a mano por un supervisor
);

-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------

-- Cabecera: un lote de trabajo de UN producto en UN sector.
-- Puede cubrir varios ítems de distintos pedidos (ej: 200 empanadas para 5 pedidos).
CREATE TABLE operations.production_tickets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id           INTEGER NOT NULL REFERENCES core.sectors(id),
    product_id          UUID    NOT NULL REFERENCES core.products(id),
    status              operations.ticket_status NOT NULL DEFAULT 'PENDING',
    time_quality        operations.time_quality  NOT NULL DEFAULT 'OK',
    closed_reason       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- entró a la cola
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,

    created_by          VARCHAR(100),
    started_by          VARCHAR(100),
    finished_by         VARCHAR(100),

    -- Reloj del dispositivo: SOLO auditoría / modo offline. Las métricas usan NOW() del server.
    client_started_at   TIMESTAMPTZ,
    client_finished_at  TIMESTAMPTZ,

    notes               TEXT,

    CONSTRAINT ticket_start_before_end CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT ticket_closed_has_times CHECK (
        status NOT IN ('DONE','AUTO_CLOSED') OR (started_at IS NOT NULL AND finished_at IS NOT NULL)
    ),
    CONSTRAINT ticket_running_has_start CHECK (
        status NOT IN ('IN_PROGRESS','PAUSED') OR started_at IS NOT NULL
    )
);

-- Detalle: qué ítems de pedido cubre el ticket.
-- Engancha a order_items (órdenes internas: ARMADO/FABRICA -> COCINA)
-- o a branch_order_items (pedidos de sucursal que confirma ARMADO/FABRICA/etc.).
CREATE TABLE operations.production_ticket_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id             UUID NOT NULL REFERENCES operations.production_tickets(id) ON DELETE CASCADE,
    order_item_id         UUID REFERENCES operations.order_items(id),
    branch_order_item_id  UUID REFERENCES operations.branch_order_items(id),
    qty_requested         DECIMAL(10,3) NOT NULL CHECK (qty_requested > 0),
    qty_produced          DECIMAL(10,3) CHECK (qty_produced >= 0),

    CONSTRAINT ticket_item_one_source CHECK (num_nonnulls(order_item_id, branch_order_item_id) = 1),
    CONSTRAINT ticket_item_unique_oi  UNIQUE (ticket_id, order_item_id),
    CONSTRAINT ticket_item_unique_boi UNIQUE (ticket_id, branch_order_item_id)
);

CREATE TABLE operations.production_ticket_pauses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   UUID NOT NULL REFERENCES operations.production_tickets(id) ON DELETE CASCADE,
    paused_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resumed_at  TIMESTAMPTZ,
    reason      TEXT,
    CONSTRAINT pause_resume_after_pause CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

-- Estándares de tiempo cargados a mano (arranque en frío, antes de tener historial)
CREATE TABLE operations.product_time_standards (
    sector_id         INTEGER NOT NULL REFERENCES core.sectors(id),
    product_id        UUID    NOT NULL REFERENCES core.products(id),
    setup_seconds     INTEGER NOT NULL DEFAULT 0 CHECK (setup_seconds >= 0),
    seconds_per_unit  DECIMAL(10,2) NOT NULL CHECK (seconds_per_unit > 0),
    allows_long_run   BOOLEAN NOT NULL DEFAULT FALSE,   -- fermentados, secado de pastas: no autocerrar
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sector_id, product_id)
);

-- Auditoría de correcciones del supervisor
CREATE TABLE operations.ticket_corrections (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        UUID NOT NULL REFERENCES operations.production_tickets(id),
    corrected_by     VARCHAR(100) NOT NULL,
    corrected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    old_status       operations.ticket_status,
    old_started_at   TIMESTAMPTZ,
    old_finished_at  TIMESTAMPTZ,
    new_started_at   TIMESTAMPTZ,
    new_finished_at  TIMESTAMPTZ,
    reason           TEXT NOT NULL CHECK (length(trim(reason)) > 0)
);

-- Bitácora de transiciones del ticket
CREATE TABLE operations.production_ticket_events (
    id               BIGSERIAL PRIMARY KEY,
    ticket_id        UUID NOT NULL REFERENCES operations.production_tickets(id) ON DELETE CASCADE,
    previous_status  operations.ticket_status,
    new_status       operations.ticket_status NOT NULL,
    changed_by       VARCHAR(100),
    changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quantity         DECIMAL(10,3),
    notes            TEXT
);

-- ---------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX ux_ticket_pause_open      ON operations.production_ticket_pauses(ticket_id) WHERE resumed_at IS NULL;
CREATE INDEX idx_ticket_pauses_ticket         ON operations.production_ticket_pauses(ticket_id);
CREATE INDEX idx_tickets_sector_status        ON operations.production_tickets(sector_id, status);
CREATE INDEX idx_tickets_open                 ON operations.production_tickets(status) WHERE status IN ('PENDING','IN_PROGRESS','PAUSED');
CREATE INDEX idx_tickets_finished_done        ON operations.production_tickets(finished_at) WHERE status = 'DONE';
CREATE INDEX idx_tickets_product              ON operations.production_tickets(product_id);
CREATE INDEX idx_ticket_items_ticket          ON operations.production_ticket_items(ticket_id);
CREATE INDEX idx_ticket_items_order_item      ON operations.production_ticket_items(order_item_id)        WHERE order_item_id IS NOT NULL;
CREATE INDEX idx_ticket_items_branch_item     ON operations.production_ticket_items(branch_order_item_id) WHERE branch_order_item_id IS NOT NULL;
CREATE INDEX idx_ticket_corrections_ticket    ON operations.ticket_corrections(ticket_id);
CREATE INDEX idx_ticket_events_ticket         ON operations.production_ticket_events(ticket_id, changed_at);

-- ---------------------------------------------------------------------
-- 4. Validación de ítems: mismo producto que el ticket y
--    un ítem no puede estar en dos tickets abiertos del mismo sector
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.trg_validate_ticket_item()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_ticket   operations.production_tickets;
    v_product  UUID;
    v_item_key UUID := COALESCE(NEW.order_item_id, NEW.branch_order_item_id);
BEGIN
    -- serializa altas concurrentes del mismo ítem (dos tablets tocando a la vez)
    PERFORM pg_advisory_xact_lock(hashtext('ticket_item:' || v_item_key::TEXT));

    SELECT * INTO v_ticket FROM operations.production_tickets WHERE id = NEW.ticket_id;

    IF NEW.order_item_id IS NOT NULL THEN
        SELECT product_id INTO v_product FROM operations.order_items WHERE id = NEW.order_item_id;
    ELSE
        SELECT product_id INTO v_product FROM operations.branch_order_items WHERE id = NEW.branch_order_item_id;
    END IF;

    IF v_product IS DISTINCT FROM v_ticket.product_id THEN
        RAISE EXCEPTION 'El ítem % es de otro producto que el ticket %', v_item_key, NEW.ticket_id;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM operations.production_ticket_items ti
          JOIN operations.production_tickets t ON t.id = ti.ticket_id
         WHERE t.sector_id = v_ticket.sector_id
           AND t.status IN ('PENDING','IN_PROGRESS','PAUSED')
           AND ti.ticket_id <> NEW.ticket_id
           AND (ti.order_item_id = NEW.order_item_id OR ti.branch_order_item_id = NEW.branch_order_item_id)
    ) THEN
        RAISE EXCEPTION 'El ítem % ya está en otro ticket abierto de este sector', v_item_key;
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER t_validate_ticket_item
BEFORE INSERT OR UPDATE OF order_item_id, branch_order_item_id ON operations.production_ticket_items
FOR EACH ROW EXECUTE FUNCTION operations.trg_validate_ticket_item();

-- ---------------------------------------------------------------------
-- 5. Transiciones (el front SOLO llama a estas funciones)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations._ticket_log(
    p_ticket UUID, p_prev operations.ticket_status, p_new operations.ticket_status,
    p_user VARCHAR, p_qty DECIMAL DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO operations.production_ticket_events (ticket_id, previous_status, new_status, changed_by, quantity, notes)
    VALUES (p_ticket, p_prev, p_new, p_user, p_qty, p_notes);
$$;

-- Confirma los ítems de pedido con las cantidades del ticket,
-- replicando lo que hoy hacen las rutas:
--   cocina (POST /api/cocina/ordenes)  -> order_items
--   armado (POST /api/armado/pedidos)  -> branch_order_items
-- confirmed_quantity se topea en lo pedido (CHECK confirmed <= requested).
CREATE OR REPLACE FUNCTION operations._ticket_confirm_items(p_ticket UUID, p_user VARCHAR)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE operations.order_items oi
       SET produced_quantity       = ti.qty_produced,
           confirmed_quantity      = LEAST(ti.qty_produced, oi.requested_quantity),
           item_status             = 'READY_FOR_PICKUP',
           confirmed_by            = p_user,
           confirmed_at            = NOW(),
           production_completed_at = NOW()
      FROM operations.production_ticket_items ti
     WHERE ti.ticket_id = p_ticket AND ti.order_item_id = oi.id;

    UPDATE operations.branch_order_items boi
       SET confirmed_quantity = LEAST(ti.qty_produced, boi.requested_quantity),
           item_status        = 'READY_FOR_PICKUP',
           confirmed_by       = p_user,
           confirmed_at       = NOW()
      FROM operations.production_ticket_items ti
     WHERE ti.ticket_id = p_ticket AND ti.branch_order_item_id = boi.id;
END $$;

-- p_items: [{"order_item_id":"uuid","qty":48}] o [{"branch_order_item_id":"uuid"}]
-- qty es opcional: si no viene, toma la cantidad pedida del ítem.
CREATE OR REPLACE FUNCTION operations.ticket_create(
    p_sector_code VARCHAR,
    p_items       JSONB,
    p_created_by  VARCHAR DEFAULT NULL,
    p_notes       TEXT    DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
    v_sector_id INTEGER;
    v_ticket_id UUID;
    v_first     JSONB;
    v_product   UUID;
    v_item      JSONB;
    v_oi        UUID;
    v_boi       UUID;
    v_req       DECIMAL;
BEGIN
    SELECT id INTO v_sector_id FROM core.sectors WHERE code = p_sector_code;
    IF v_sector_id IS NULL THEN
        RAISE EXCEPTION 'Sector % no existe', p_sector_code;
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'El ticket necesita al menos un ítem';
    END IF;

    v_first := p_items -> 0;
    IF v_first ? 'order_item_id' THEN
        SELECT product_id INTO v_product FROM operations.order_items WHERE id = (v_first->>'order_item_id')::UUID;
    ELSE
        SELECT product_id INTO v_product FROM operations.branch_order_items WHERE id = (v_first->>'branch_order_item_id')::UUID;
    END IF;
    IF v_product IS NULL THEN
        RAISE EXCEPTION 'Ítem inicial no encontrado: %', v_first;
    END IF;

    INSERT INTO operations.production_tickets (sector_id, product_id, created_by, notes)
    VALUES (v_sector_id, v_product, p_created_by, p_notes)
    RETURNING id INTO v_ticket_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_oi  := (v_item->>'order_item_id')::UUID;
        v_boi := (v_item->>'branch_order_item_id')::UUID;

        IF v_oi IS NOT NULL THEN
            SELECT requested_quantity INTO v_req FROM operations.order_items WHERE id = v_oi;
        ELSE
            SELECT requested_quantity INTO v_req FROM operations.branch_order_items WHERE id = v_boi;
        END IF;

        INSERT INTO operations.production_ticket_items (ticket_id, order_item_id, branch_order_item_id, qty_requested)
        VALUES (v_ticket_id, v_oi, v_boi, COALESCE((v_item->>'qty')::DECIMAL, v_req));
    END LOOP;

    PERFORM operations._ticket_log(v_ticket_id, NULL, 'PENDING', p_created_by);
    RETURN v_ticket_id;
END $$;

CREATE OR REPLACE FUNCTION operations.ticket_start(
    p_ticket    UUID,
    p_user      VARCHAR,
    p_client_ts TIMESTAMPTZ DEFAULT NULL
) RETURNS operations.production_tickets LANGUAGE plpgsql AS $$
DECLARE r operations.production_tickets;
BEGIN
    UPDATE operations.production_tickets
       SET status = 'IN_PROGRESS', started_at = NOW(), started_by = p_user, client_started_at = p_client_ts
     WHERE id = p_ticket AND status = 'PENDING'
    RETURNING * INTO r;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % no está PENDING', p_ticket;
    END IF;

    -- Reflejar en order_items (cocina ya muestra IN_PRODUCTION en su GET)
    UPDATE operations.order_items oi
       SET production_started_at = COALESCE(oi.production_started_at, NOW()),
           item_status = CASE WHEN oi.item_status = 'PENDING_CONFIRMATION' THEN 'IN_PRODUCTION' ELSE oi.item_status END
      FROM operations.production_ticket_items ti
     WHERE ti.ticket_id = p_ticket AND ti.order_item_id = oi.id;
    -- branch_order_items NO se tocan al iniciar: en Fábrica IN_PRODUCTION
    -- significa "marcado con cantidad" (PATCH /api/fabrica/marcar).

    PERFORM operations._ticket_log(p_ticket, 'PENDING', 'IN_PROGRESS', p_user);
    RETURN r;
END $$;

CREATE OR REPLACE FUNCTION operations.ticket_pause(
    p_ticket UUID,
    p_user   VARCHAR DEFAULT NULL,
    p_reason TEXT    DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_sector INTEGER;
BEGIN
    UPDATE operations.production_tickets SET status = 'PAUSED'
     WHERE id = p_ticket AND status = 'IN_PROGRESS'
    RETURNING sector_id INTO v_sector;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % no está IN_PROGRESS', p_ticket;
    END IF;
    INSERT INTO operations.production_ticket_pauses (ticket_id, reason) VALUES (p_ticket, p_reason);
    PERFORM operations._ticket_log(p_ticket, 'IN_PROGRESS', 'PAUSED', p_user, NULL, p_reason);
END $$;

CREATE OR REPLACE FUNCTION operations.ticket_resume(
    p_ticket UUID,
    p_user   VARCHAR DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_sector INTEGER;
BEGIN
    UPDATE operations.production_tickets SET status = 'IN_PROGRESS'
     WHERE id = p_ticket AND status = 'PAUSED'
    RETURNING sector_id INTO v_sector;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket % no está PAUSED', p_ticket;
    END IF;
    UPDATE operations.production_ticket_pauses SET resumed_at = NOW()
     WHERE ticket_id = p_ticket AND resumed_at IS NULL;
    PERFORM operations._ticket_log(p_ticket, 'PAUSED', 'IN_PROGRESS', p_user);
END $$;

-- Cantidades producidas por ítem (formato compartido por finish y review):
--   [{"item_id":"<order_item_id o branch_order_item_id>","qty":48}, ...]
-- Ítems que no vengan en el JSON quedan con qty_produced = qty_requested.
CREATE OR REPLACE FUNCTION operations._ticket_apply_qty(p_ticket UUID, p_qty JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE operations.production_ticket_items ti
       SET qty_produced = COALESCE(
               (SELECT (x->>'qty')::DECIMAL
                  FROM jsonb_array_elements(COALESCE(p_qty, '[]'::jsonb)) x
                 WHERE (x->>'item_id')::UUID = COALESCE(ti.order_item_id, ti.branch_order_item_id)
                 LIMIT 1),
               ti.qty_requested)
     WHERE ti.ticket_id = p_ticket;
END $$;

-- Cierra el ticket y, con p_confirm = TRUE (default), confirma los ítems de pedido
-- igual que hoy lo hacen las rutas de cocina/armado. NO toca stock.
CREATE OR REPLACE FUNCTION operations.ticket_finish(
    p_ticket    UUID,
    p_user      VARCHAR,
    p_qty       JSONB       DEFAULT NULL,
    p_client_ts TIMESTAMPTZ DEFAULT NULL,
    p_confirm   BOOLEAN     DEFAULT TRUE
) RETURNS operations.production_tickets LANGUAGE plpgsql AS $$
DECLARE
    r       operations.production_tickets;
    v_prev  operations.ticket_status;
    v_total DECIMAL;
BEGIN
    SELECT status INTO v_prev FROM operations.production_tickets WHERE id = p_ticket FOR UPDATE;
    IF v_prev IS NULL OR v_prev NOT IN ('IN_PROGRESS','PAUSED') THEN
        RAISE EXCEPTION 'Ticket % no está en curso (estado: %)', p_ticket, v_prev;
    END IF;

    -- cerrar pausa abierta ANTES de cerrar el ticket (el trigger de calidad la necesita cerrada)
    UPDATE operations.production_ticket_pauses SET resumed_at = NOW()
     WHERE ticket_id = p_ticket AND resumed_at IS NULL;

    PERFORM operations._ticket_apply_qty(p_ticket, p_qty);

    UPDATE operations.production_tickets
       SET status = 'DONE', finished_at = NOW(), finished_by = p_user, client_finished_at = p_client_ts
     WHERE id = p_ticket
    RETURNING * INTO r;

    IF p_confirm THEN
        PERFORM operations._ticket_confirm_items(p_ticket, p_user);
    END IF;

    SELECT SUM(qty_produced) INTO v_total FROM operations.production_ticket_items WHERE ticket_id = p_ticket;
    PERFORM operations._ticket_log(p_ticket, v_prev, 'DONE', p_user, v_total, r.closed_reason);
    RETURN r;
END $$;

CREATE OR REPLACE FUNCTION operations.ticket_cancel(
    p_ticket UUID,
    p_user   VARCHAR,
    p_reason TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_prev operations.ticket_status; v_sector INTEGER;
BEGIN
    SELECT status, sector_id INTO v_prev, v_sector FROM operations.production_tickets WHERE id = p_ticket FOR UPDATE;
    IF v_prev IS NULL OR v_prev NOT IN ('PENDING','IN_PROGRESS','PAUSED') THEN
        RAISE EXCEPTION 'Ticket % no se puede cancelar (estado: %)', p_ticket, v_prev;
    END IF;
    UPDATE operations.production_ticket_pauses SET resumed_at = NOW() WHERE ticket_id = p_ticket AND resumed_at IS NULL;
    UPDATE operations.production_tickets
       SET status = 'CANCELLED', time_quality = 'UNRELIABLE', closed_reason = p_reason,
           finished_at = CASE WHEN started_at IS NOT NULL THEN NOW() END
     WHERE id = p_ticket;
    PERFORM operations._ticket_log(p_ticket, v_prev, 'CANCELLED', p_user, NULL, p_reason);
END $$;

-- ---------------------------------------------------------------------
-- 6. Métricas por ticket
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW operations.v_ticket_metrics AS
SELECT
    t.id, t.sector_id, t.product_id, t.started_by,
    t.created_at, t.started_at, t.finished_at,
    t.started_at - t.created_at                                               AS espera_en_cola,
    t.finished_at - t.started_at                                              AS tiempo_bruto,
    COALESCE(p.pausado, INTERVAL '0')                                         AS tiempo_pausado,
    (t.finished_at - t.started_at) - COALESCE(p.pausado, INTERVAL '0')        AS tiempo_neto,
    i.pedido,
    i.producido,
    ROUND(i.producido / NULLIF(i.pedido, 0) * 100, 1)                         AS cumplimiento_pct,
    ROUND(EXTRACT(EPOCH FROM (t.finished_at - t.started_at) - COALESCE(p.pausado, INTERVAL '0'))
          / NULLIF(i.producido, 0), 1)                                        AS seg_por_unidad,
    t.time_quality
FROM operations.production_tickets t
LEFT JOIN LATERAL (
    SELECT SUM(COALESCE(pp.resumed_at, t.finished_at) - pp.paused_at) AS pausado
      FROM operations.production_ticket_pauses pp WHERE pp.ticket_id = t.id
) p ON TRUE
JOIN LATERAL (
    SELECT SUM(ti.qty_requested) AS pedido, SUM(ti.qty_produced) AS producido
      FROM operations.production_ticket_items ti WHERE ti.ticket_id = t.id
) i ON TRUE
WHERE t.status = 'DONE';

-- Historial real: solo datos OK, últimos 90 días, mínimo 10 tickets por producto
CREATE MATERIALIZED VIEW operations.mv_product_time_history AS
SELECT sector_id, product_id, COUNT(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY seg_por_unidad) AS p50_seg_unidad,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY seg_por_unidad) AS p90_seg_unidad
  FROM operations.v_ticket_metrics
 WHERE time_quality = 'OK'
   AND finished_at >= NOW() - INTERVAL '90 days'
   AND seg_por_unidad IS NOT NULL
 GROUP BY sector_id, product_id
HAVING COUNT(*) >= 10;

CREATE UNIQUE INDEX ux_mv_product_time_history ON operations.mv_product_time_history(sector_id, product_id);

CREATE OR REPLACE FUNCTION operations.refresh_ticket_history()
RETURNS VOID LANGUAGE sql AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY operations.mv_product_time_history;
$$;

-- ---------------------------------------------------------------------
-- 7. Tiempo esperado de un ticket (segundos)
--    prioridad: historial real > estándar manual > receta > 1 hora
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.ticket_expected_seconds(p_ticket UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    WITH t AS (
        SELECT pt.sector_id, pt.product_id, SUM(ti.qty_requested) AS qty
          FROM operations.production_tickets pt
          JOIN operations.production_ticket_items ti ON ti.ticket_id = pt.id
         WHERE pt.id = p_ticket
         GROUP BY pt.sector_id, pt.product_id
    )
    SELECT COALESCE(
        (SELECT COALESCE(s.setup_seconds, 0) + h.p90_seg_unidad::NUMERIC * t.qty
           FROM operations.mv_product_time_history h
           LEFT JOIN operations.product_time_standards s
                  ON s.sector_id = h.sector_id AND s.product_id = h.product_id
          WHERE h.sector_id = t.sector_id AND h.product_id = t.product_id),
        (SELECT s.setup_seconds + s.seconds_per_unit * t.qty
           FROM operations.product_time_standards s
          WHERE s.sector_id = t.sector_id AND s.product_id = t.product_id),
        (SELECT r.total_time_minutes * 60.0 * t.qty / NULLIF(r.yield_quantity, 0)
           FROM core.recipes r
          WHERE r.product_id = t.product_id AND r.is_active AND r.total_time_minutes > 0),
        3600
    )
    FROM t;
$$;

-- ---------------------------------------------------------------------
-- 8. Semáforo en vivo (el KDS consulta esta vista)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW operations.v_open_tickets_health AS
WITH base AS (
    SELECT t.id, t.sector_id, sec.code AS sector_code, t.product_id, prod.official_name AS product,
           t.status, t.started_by, t.created_at, t.started_at,
           EXTRACT(EPOCH FROM (NOW() - t.started_at) - COALESCE(p.pausado, INTERVAL '0')) AS elapsed_net_s,
           p.pausa_abierta_desde,
           operations.ticket_expected_seconds(t.id) AS expected_s,
           COALESCE(s.allows_long_run, FALSE)       AS allows_long_run
      FROM operations.production_tickets t
      JOIN core.sectors  sec  ON sec.id  = t.sector_id
      JOIN core.products prod ON prod.id = t.product_id
      LEFT JOIN operations.product_time_standards s
             ON s.sector_id = t.sector_id AND s.product_id = t.product_id
      LEFT JOIN LATERAL (
          SELECT SUM(COALESCE(pp.resumed_at, NOW()) - pp.paused_at)       AS pausado,
                 MAX(pp.paused_at) FILTER (WHERE pp.resumed_at IS NULL)   AS pausa_abierta_desde
            FROM operations.production_ticket_pauses pp WHERE pp.ticket_id = t.id
      ) p ON TRUE
     WHERE t.status IN ('IN_PROGRESS','PAUSED')
)
SELECT *,
       ROUND(elapsed_net_s / NULLIF(expected_s, 0), 2) AS ratio,
       CASE
           WHEN status = 'PAUSED' AND NOW() - pausa_abierta_desde > INTERVAL '45 minutes' THEN 'PAUSA_LARGA'
           WHEN allows_long_run                        THEN 'OK'
           WHEN elapsed_net_s >= expected_s * 3        THEN 'CRITICO'
           WHEN elapsed_net_s >= expected_s * 1.5      THEN 'ATENCION'
           ELSE 'OK'
       END AS alerta
  FROM base;

-- ---------------------------------------------------------------------
-- 9. Calidad del dato al finalizar (cerrado tarde o "de una")
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.trg_ticket_quality()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_expected NUMERIC;
    v_net      NUMERIC;
BEGIN
    IF NEW.status = 'DONE' AND OLD.status IS DISTINCT FROM 'DONE' AND NEW.time_quality = 'OK' THEN
        v_expected := operations.ticket_expected_seconds(NEW.id);

        SELECT EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at)
               - COALESCE(SUM(COALESCE(pp.resumed_at, NEW.finished_at) - pp.paused_at), INTERVAL '0'))
          INTO v_net
          FROM operations.production_ticket_pauses pp
         WHERE pp.ticket_id = NEW.id;

        IF v_net > v_expected * 3 THEN
            NEW.time_quality  := 'SUSPECT';
            NEW.closed_reason := 'Cerrado tarde (>3x esperado)';
        ELSIF v_net < v_expected * 0.2 THEN
            NEW.time_quality  := 'SUSPECT';
            NEW.closed_reason := 'Cerrado demasiado rápido (<0.2x esperado)';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER t_ticket_quality
BEFORE UPDATE OF status ON operations.production_tickets
FOR EACH ROW EXECUTE FUNCTION operations.trg_ticket_quality();

-- ---------------------------------------------------------------------
-- 10. Autocierre de abandonados. NO confirma producción.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.ticket_auto_close_stale(
    p_factor    NUMERIC  DEFAULT 4,
    p_max_age   INTERVAL DEFAULT '10 hours',
    p_close_all BOOLEAN  DEFAULT FALSE        -- TRUE = cierre de turno
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    v_row    RECORD;
    v_count  INTEGER := 0;
    v_reason TEXT := CASE WHEN p_close_all THEN 'Cierre de turno' ELSE 'Abandonado' END;
BEGIN
    FOR v_row IN
        SELECT h.id, h.sector_id, h.status
          FROM operations.v_open_tickets_health h
         WHERE NOT h.allows_long_run
           AND ( p_close_all
              OR h.elapsed_net_s >= h.expected_s * p_factor
              OR NOW() - h.started_at >= p_max_age )
    LOOP
        UPDATE operations.production_ticket_pauses SET resumed_at = NOW()
         WHERE ticket_id = v_row.id AND resumed_at IS NULL;

        UPDATE operations.production_tickets
           SET status = 'AUTO_CLOSED', finished_at = NOW(),
               time_quality = 'UNRELIABLE', closed_reason = v_reason
         WHERE id = v_row.id AND status IN ('IN_PROGRESS','PAUSED');

        IF FOUND THEN
            PERFORM operations._ticket_log(v_row.id, v_row.status, 'AUTO_CLOSED', 'SISTEMA', NULL, v_reason);
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END $$;

-- ---------------------------------------------------------------------
-- 11. Revisión del supervisor (corrige tiempos y deja auditoría)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION operations.ticket_review(
    p_ticket   UUID,
    p_user     VARCHAR,
    p_started  TIMESTAMPTZ,
    p_finished TIMESTAMPTZ,
    p_reason   TEXT,
    p_qty      JSONB DEFAULT NULL   -- obligatorio si el ticket está AUTO_CLOSED
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    r       operations.production_tickets;
    v_total DECIMAL;
BEGIN
    SELECT * INTO r FROM operations.production_tickets WHERE id = p_ticket FOR UPDATE;
    IF NOT FOUND OR r.status NOT IN ('AUTO_CLOSED','DONE') THEN
        RAISE EXCEPTION 'Ticket % no está cerrado', p_ticket;
    END IF;
    IF r.status = 'AUTO_CLOSED' AND p_qty IS NULL THEN
        RAISE EXCEPTION 'Ticket % autocerrado: hay que informar cantidades producidas', p_ticket;
    END IF;
    IF p_finished < p_started THEN
        RAISE EXCEPTION 'El fin no puede ser anterior al inicio';
    END IF;

    INSERT INTO operations.ticket_corrections
        (ticket_id, corrected_by, old_status, old_started_at, old_finished_at, new_started_at, new_finished_at, reason)
    VALUES (p_ticket, p_user, r.status, r.started_at, r.finished_at, p_started, p_finished, p_reason);

    -- pausas que queden fuera del rango corregido no tienen sentido: se recortan
    DELETE FROM operations.production_ticket_pauses
     WHERE ticket_id = p_ticket AND (paused_at >= p_finished OR resumed_at <= p_started);
    UPDATE operations.production_ticket_pauses
       SET paused_at  = GREATEST(paused_at, p_started),
           resumed_at = LEAST(resumed_at, p_finished)
     WHERE ticket_id = p_ticket;

    IF p_qty IS NOT NULL THEN
        PERFORM operations._ticket_apply_qty(p_ticket, p_qty);
    END IF;

    UPDATE operations.production_tickets
       SET status = 'DONE', started_at = p_started, finished_at = p_finished,
           finished_by = COALESCE(finished_by, p_user), time_quality = 'CORRECTED'
     WHERE id = p_ticket;

    -- un autocerrado nunca confirmó: recién acá avanza el pedido
    IF r.status = 'AUTO_CLOSED' THEN
        PERFORM operations._ticket_confirm_items(p_ticket, p_user);
    END IF;

    SELECT SUM(qty_produced) INTO v_total FROM operations.production_ticket_items WHERE ticket_id = p_ticket;
    PERFORM operations._ticket_log(p_ticket, r.status, 'DONE', p_user, v_total, 'Revisión: ' || p_reason);
END $$;

-- Bandeja del supervisor
CREATE OR REPLACE VIEW operations.v_tickets_to_review AS
SELECT t.id, sec.code AS sector_code, p.official_name AS product, t.status, t.time_quality,
       t.closed_reason, t.started_by, t.started_at, t.finished_at,
       operations.ticket_expected_seconds(t.id) AS expected_s
  FROM operations.production_tickets t
  JOIN core.sectors  sec ON sec.id = t.sector_id
  JOIN core.products p   ON p.id   = t.product_id
 WHERE t.status = 'AUTO_CLOSED'
    OR (t.status = 'DONE' AND t.time_quality = 'SUSPECT')
 ORDER BY t.finished_at;

-- ---------------------------------------------------------------------
-- 12. Comentarios
-- ---------------------------------------------------------------------
COMMENT ON TABLE operations.production_tickets IS 'Ticket de trabajo (lote de un producto en un sector) con inicio/fin para medir tiempos';
COMMENT ON TABLE operations.production_ticket_items IS 'Ítems de pedido (order_items o branch_order_items) que cubre cada ticket';
COMMENT ON TABLE operations.production_ticket_pauses IS 'Pausas de un ticket; el tiempo neto descuenta estas pausas';
COMMENT ON TABLE operations.product_time_standards IS 'Tiempos estándar cargados a mano; se usan hasta tener 10+ tickets de historial';
COMMENT ON FUNCTION operations.ticket_finish IS 'Cierra el ticket, registra cantidades y (p_confirm) confirma los ítems como hoy lo hacen cocina/armado. NO toca stock';
COMMENT ON FUNCTION operations.ticket_auto_close_stale IS 'Cierra tickets abandonados como AUTO_CLOSED (no confirman producción). Correr cada 15 min y al cierre de turno';

COMMIT;
