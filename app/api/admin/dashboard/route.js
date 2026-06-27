// app/api/admin/dashboard/route.js
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
    // KPIs del día — vista regular (verified: no matviews in this DB)
    // Usa CURRENT_DATE del servidor PostgreSQL
    const kpis = await prisma.$queryRaw`
      SELECT metrica, valor FROM operations.executive_dashboard
    `

    // Producción últimos 30 días — filtrado a órdenes completadas con PRODUCTION_ORDER
    // fecha viene como timestamptz truncada al día
    const produccion = await prisma.$queryRaw`
      SELECT
        fecha,
        sector,
        ordenes_completadas,
        items_producidos,
        cantidad_total,
        minutos_promedio_produccion
      FROM operations.daily_production_report
      ORDER BY fecha DESC, sector ASC
    `

    // Remitos de los últimos 7 días (en tránsito y entregados)
    const remitos = await prisma.$queryRaw`
      SELECT
        shipment_number,
        shipment_type,
        status,
        branch_code,
        branch_name,
        from_sector,
        total_items,
        dispatched_at,
        delivered_at,
        delivery_hours,
        driver_name
      FROM operations.view_shipments_dashboard
      WHERE dispatched_at >= NOW() - INTERVAL '7 days'
         OR status = 'IN_TRANSIT'
      ORDER BY dispatched_at DESC NULLS LAST
      LIMIT 50
    `

    // Movimientos de stock recientes (vista, últimas 24h)
    const stockMovimientos = await prisma.$queryRaw`
      SELECT
        created_at,
        sector,
        producto,
        tipo_movimiento,
        cantidad,
        unidad,
        stock_antes,
        stock_despues,
        usuario
      FROM operations.recent_stock_movements
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 30
    `

    return NextResponse.json({
      kpis:             serialize(kpis),
      produccion:       serialize(produccion),
      remitos:          serialize(remitos),
      stockMovimientos: serialize(stockMovimientos),
      generado_at:      new Date().toISOString(),
    })
  } catch (err) {
    console.error('[GET /api/admin/dashboard]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
