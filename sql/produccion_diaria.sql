-- Ejecutar en psql/pgAdmin como superuser
-- Schemas: core, operations
--
-- "Producción del día": versión digital de la planilla de papel RC-7397-2 que
-- hoy llena Fábrica a mano (foto de ejemplo de Fede, 09/09/2026), extendida a
-- Armado y Fraccionado.
--
-- Decisión con Fede (09/09/2026): esta v1 SOLO REGISTRA lo cargado. NO toca
-- operations.stock ni genera stock_movements todavía — evita descuadrar
-- inventario mientras el flujo no está probado en uso real. Cuando se decida
-- dar el paso, operations.update_stock() (ver add_conversion_factor.sql) ya
-- está listo para recorrer production_log_inputs (restar de Depósito) y
-- production_log_outputs (sumar en el sector) sin tocar este esquema.
--
-- Una fila de production_logs = un sector + un día. Guardar de nuevo ese día
-- reemplaza sus insumos/producido (upsert de cabecera + replace de detalle),
-- no acumula filas duplicadas si cargan la planilla en varias tandas.

-- ── 1. Nuevo flag de catálogo para Fraccionado ──────────────────────────────
-- Mismo patrón que is_produced_in_fabrica / is_produced_in_armado, para que
-- "Carga de producción diaria" muestre en cada sector solo SUS productos.
-- Fede marca manualmente qué productos produce Fraccionado desde
-- Admin → Catálogo (misma pantalla donde ya marca Fábrica/Armado).

ALTER TABLE core.products
  ADD COLUMN IF NOT EXISTS is_produced_in_fraccionado BOOLEAN DEFAULT false;

COMMENT ON COLUMN core.products.is_produced_in_fraccionado IS
  'true = aparece en la pantalla "Producción del día" de Fraccionado.';

-- ── 2. Cabecera: un registro por sector + día ───────────────────────────────

CREATE TABLE IF NOT EXISTS operations.production_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id   INTEGER NOT NULL REFERENCES core.sectors(id),
  log_date    DATE NOT NULL,
  notes       TEXT,
  created_by  VARCHAR(100),
  updated_by  VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sector_id, log_date)
);

COMMENT ON TABLE operations.production_logs IS
  'Cabecera de "Producción del día" por sector (Fábrica/Armado/Fraccionado). Reemplaza la planilla de papel RC-7397-2.';

-- ── 3. Detalle: materia prima e insumos retirados de Depósito ──────────────

CREATE TABLE IF NOT EXISTS operations.production_log_inputs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_log_id  UUID NOT NULL REFERENCES operations.production_logs(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES core.products(id),
  quantity           NUMERIC(10, 3) NOT NULL CHECK (quantity > 0),
  unit               VARCHAR(20) NOT NULL DEFAULT 'KG',
  brand              VARCHAR(100),   -- MARCA (papel): texto libre, varía por compra
  lot_code           VARCHAR(100),   -- LOTE (papel)
  expires_at         DATE,           -- FECHA VENCIMIENTO (papel)
  sort_order         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE operations.production_log_inputs IS
  '"Materia prima e insumos retirados de Depósito" — fila = una línea de la planilla de papel.';

CREATE INDEX IF NOT EXISTS idx_production_log_inputs_log
  ON operations.production_log_inputs (production_log_id);

-- ── 4. Detalle: carga de producción diaria (lo efectivamente producido) ────

CREATE TABLE IF NOT EXISTS operations.production_log_outputs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_log_id  UUID NOT NULL REFERENCES operations.production_logs(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES core.products(id),
  quantity           NUMERIC(10, 3) NOT NULL CHECK (quantity > 0),
  unit               VARCHAR(20) NOT NULL DEFAULT 'KG',
  sort_order         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE operations.production_log_outputs IS
  '"Carga de producción diaria de [Sector]" — fila = un producto terminado y su cantidad ese día.';

CREATE INDEX IF NOT EXISTS idx_production_log_outputs_log
  ON operations.production_log_outputs (production_log_id);
