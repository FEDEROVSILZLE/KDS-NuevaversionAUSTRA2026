// app/api/admin/estado-live/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

function serialize(rows) {
  return JSON.parse(JSON.stringify(rows, (_, v) =>
    typeof v === 'bigint' ? Number(v) :
    (v && v.constructor?.name === 'Decimal') ? Number(v) : v
  ))
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    // Carga de trabajo por sector (items_pendientes, items_listos, etc.)
    // La vista filtra: ARMADO, DEPOSITO, FABRICA, COCINA, FRACCIONADO
    const workload = await prisma.$queryRaw`
      SELECT
        sector,
        pedidos_pendientes,
        items_pendientes,
        items_listos,
        ordenes_en_produccion,
        promedio_horas_espera
      FROM operations.sector_workload
    `

    // Actividad reciente — últimas 8 horas
    // entity_type real: 'branch_order' | 'internal_order' (verificado en triggers)
    const actividad = await prisma.$queryRaw`
      SELECT
        changed_at,
        entity_type,
        entity_id,
        previous_status,
        new_status,
        metadata
      FROM audit.get_recent_activity(8)
      ORDER BY changed_at DESC
      LIMIT 40
    `

    // Pedidos de sucursal activos (no cancelados ni entregados)
    // Columnas con bigint/numeric — necesitan serialize
    const pedidosActivos = await prisma.$queryRaw`
      SELECT
        id,
        order_number,
        branch_code,
        branch_name,
        status,
        requested_delivery_date,
        priority,
        total_items,
        confirmed_items,
        sectors_involved,
        hours_since_created
      FROM operations.branch_orders_dashboard
      WHERE status NOT IN ('DELIVERED', 'CANCELLED')
      ORDER BY priority ASC, requested_delivery_date ASC
      LIMIT 30
    `

    return NextResponse.json({
      workload:       serialize(workload),
      actividad:      serialize(actividad),
      pedidosActivos: serialize(pedidosActivos),
    })
  } catch (err) {
    console.error('[GET /api/admin/estado-live]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
