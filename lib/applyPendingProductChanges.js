// lib/applyPendingProductChanges.js
// Aplica todos los cambios PENDING de core.product_pending_changes en transacciones
// individuales con FOR UPDATE SKIP LOCKED → atómica contra doble click y concurrencia.
import { prisma } from '@/lib/prisma'

const EDITABLE_FIELDS = [
  'official_name', 'base_unit', 'condition', 'sub_condition', 'codigo_tango',
  'is_for_branches', 'is_produced_in_kitchen', 'is_produced_in_fabrica',
  'is_produced_in_armado', 'is_fractionable', 'is_active',
]

function sanitizePayload(payload) {
  const data = {}
  for (const key of EDITABLE_FIELDS) {
    if (!(key in payload)) continue
    if (key === 'codigo_tango') {
      const v = payload[key]
      data[key] = (v !== '' && v !== null && v !== undefined) ? Number(v) : null
    } else {
      data[key] = payload[key]
    }
  }
  return data
}

export async function applyPendingProductChanges() {
  // Obtener IDs de pendientes (sin bloquear aún)
  const pendingRows = await prisma.$queryRaw`
    SELECT id FROM core.product_pending_changes WHERE status = 'PENDING'
  `
  if (pendingRows.length === 0) return { applied: 0, failed: 0, total: 0 }

  let applied = 0, failed = 0

  for (const row of pendingRows) {
    try {
      await prisma.$transaction(async (tx) => {
        // Bloquear esta fila específica; SKIP LOCKED = idempotente contra concurrencia
        const locked = await tx.$queryRaw`
          SELECT id, product_id, payload
          FROM core.product_pending_changes
          WHERE id = ${row.id}::uuid AND status = 'PENDING'
          FOR UPDATE SKIP LOCKED
        `
        if (locked.length === 0) return // otro proceso la tomó primero

        const change  = locked[0]
        const payload = change.payload

        // Verificar que el producto exista
        const product = await tx.products.findUnique({
          where: { id: change.product_id },
          select: { id: true },
        })
        if (!product) throw new Error(`Producto ${change.product_id} no encontrado`)

        // Verificar unicidad del nuevo nombre (si cambia)
        if (payload.official_name !== undefined) {
          const conflict = await tx.$queryRaw`
            SELECT id FROM core.products
            WHERE UPPER(TRIM(official_name)) = UPPER(TRIM(${payload.official_name}))
              AND id != ${change.product_id}::uuid
            LIMIT 1
          `
          if (conflict.length > 0) {
            throw new Error(`Nombre '${payload.official_name}' ya existe en otro artículo`)
          }
        }

        // Aplicar cambios — updated_at lo maneja el trigger, no incluir
        await tx.products.update({
          where: { id: change.product_id },
          data:  sanitizePayload(payload),
        })

        // Marcar APPLIED
        await tx.$queryRaw`
          UPDATE core.product_pending_changes
          SET status = 'APPLIED', applied_at = NOW()
          WHERE id = ${change.id}::uuid
        `
      })
      applied++
    } catch (err) {
      console.error(`[applyPending] Error en pending ${row.id}:`, err.message)
      // Marcar FAILED en transacción separada (la anterior fue rollback)
      try {
        await prisma.$queryRaw`
          UPDATE core.product_pending_changes
          SET status = 'FAILED', applied_at = NOW()
          WHERE id = ${row.id}::uuid AND status = 'PENDING'
        `
      } catch (e2) {
        console.error('[applyPending] Error al marcar FAILED:', e2.message)
      }
      failed++
    }
  }

  return { applied, failed, total: pendingRows.length }
}
