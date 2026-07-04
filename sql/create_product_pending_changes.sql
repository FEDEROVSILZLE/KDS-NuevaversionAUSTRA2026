-- Ejecutar en psql como superuser antes de usar el CRUD de artículos
-- Schema: core

CREATE TABLE IF NOT EXISTS core.product_pending_changes (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id   UUID         NOT NULL REFERENCES core.products(id),
  payload      JSONB        NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                            CONSTRAINT ppc_status_check
                            CHECK (status IN ('PENDING', 'APPLIED', 'CANCELLED', 'FAILED')),
  created_by   VARCHAR(100),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  applied_at   TIMESTAMPTZ
);

-- Un solo PENDING por producto; upsert reemplaza el payload anterior
CREATE UNIQUE INDEX IF NOT EXISTS product_pending_changes_one_pending
  ON core.product_pending_changes (product_id)
  WHERE (status = 'PENDING');

-- Índice para listar historial por producto
CREATE INDEX IF NOT EXISTS product_pending_changes_product_id
  ON core.product_pending_changes (product_id, created_at DESC);

COMMENT ON TABLE core.product_pending_changes IS
  'Cola de cambios pendientes sobre core.products. El admin aplica todos juntos con el botón "Aplicar".';
