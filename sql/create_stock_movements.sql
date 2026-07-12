-- Ejecutar en psql/pgAdmin como superuser
-- Schema: operations
-- Crea la tabla de auditoría de movimientos de stock + la vista que lee el Dashboard.
-- El enum operations.movement_type y las tablas core.sectors / core.products ya existen.

CREATE TABLE IF NOT EXISTS operations.stock_movements (
  id              UUID                      PRIMARY KEY DEFAULT uuid_generate_v4(),
  sector_id       INTEGER                   NOT NULL REFERENCES core.sectors(id),
  product_id      UUID                      NOT NULL REFERENCES core.products(id),
  movement_type   operations.movement_type  NOT NULL,
  quantity        NUMERIC(10, 3)            NOT NULL,
  unit            VARCHAR(20)               NOT NULL,
  stock_before    NUMERIC(10, 3),
  stock_after     NUMERIC(10, 3),
  reference_id    UUID,
  reference_type  VARCHAR(50),
  created_by      VARCHAR(100),
  created_at      TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_date
  ON operations.stock_movements (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON operations.stock_movements (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_sector_product
  ON operations.stock_movements (sector_id, product_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_type
  ON operations.stock_movements (movement_type);

COMMENT ON TABLE operations.stock_movements IS
  'Historial de movimientos de stock (producción, consumo, despacho, ajustes por conteo, etc).';

-- Vista que lee app/api/admin/dashboard/route.js — columnas con los nombres exactos que espera esa query.
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
  sm.created_by        AS usuario
FROM operations.stock_movements sm
JOIN core.sectors  s ON s.id = sm.sector_id
JOIN core.products p ON p.id = sm.product_id
ORDER BY sm.created_at DESC;
