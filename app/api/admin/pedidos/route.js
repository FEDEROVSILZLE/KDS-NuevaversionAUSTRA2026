// app/api/admin/pedidos/route.js
// GET ?tipo=sucursal|interna  &fecha=YYYY-MM-DD  &estado=X  &branch_code=X  &sector_id=N  &pagina=0
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

const POR_PAGINA = 50

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tipo      = searchParams.get('tipo') || 'sucursal'
  const fecha     = searchParams.get('fecha')       // YYYY-MM-DD (fecha AR)
  const estado    = searchParams.get('estado')
  const branchCode = searchParams.get('branch_code')
  const sectorId  = searchParams.get('sector_id') ? parseInt(searchParams.get('sector_id')) : null
  const pagina    = parseInt(searchParams.get('pagina') || '0')

  try {
    // ── Pedidos de SUCURSAL (branch_orders) ──────────────────────────────
    if (tipo === 'sucursal') {
      const where = { is_active: true }

      if (fecha) {
        // requested_delivery_date es @db.Date — usar fecha exacta
        where.requested_delivery_date = new Date(fecha + 'T12:00:00')
      }
      if (estado)     where.status      = estado
      if (branchCode) where.branch_code = branchCode

      const [total, rows] = await Promise.all([
        prisma.branch_orders.count({ where }),
        prisma.branch_orders.findMany({
          where,
          select: {
            id:                      true,
            order_number:            true,
            branch_code:             true,
            branch_name:             true,
            status:                  true,
            requested_delivery_date: true,
            priority:                true,
            notes:                   true,
            created_at:              true,
            _count: { select: { branch_order_items: true } },
          },
          orderBy: [{ priority: 'asc' }, { requested_delivery_date: 'asc' }, { created_at: 'desc' }],
          skip:  pagina * POR_PAGINA,
          take:  POR_PAGINA,
        }),
      ])

      return NextResponse.json(serialize({
        tipo,
        total,
        pagina,
        por_pagina: POR_PAGINA,
        rows: rows.map(r => ({
          ...r,
          total_items: r._count.branch_order_items,
          _count: undefined,
        })),
      }))
    }

    // ── Órdenes INTERNAS (orders) ─────────────────────────────────────────
    const where = { is_active: true }

    if (fecha) {
      // Filtrar created_at por día AR (UTC-3 fijo)
      // Inicio del día AR = fecha 03:00 UTC, fin = fecha+1 03:00 UTC
      const startUTC = new Date(fecha + 'T03:00:00Z')
      const endUTC   = new Date(fecha + 'T03:00:00Z')
      endUTC.setDate(endUTC.getDate() + 1)
      where.created_at = { gte: startUTC, lt: endUTC }
    }
    if (estado)   where.status        = estado
    if (sectorId) where.to_sector_id  = sectorId

    const [total, rows] = await Promise.all([
      prisma.orders.count({ where }),
      prisma.orders.findMany({
        where,
        select: {
          id:           true,
          order_number: true,
          order_type:   true,
          status:       true,
          priority:     true,
          started_at:   true,
          completed_at: true,
          created_at:   true,
          notes:        true,
          sectors_orders_from_sector_idTosectors: { select: { name: true, code: true } },
          sectors_orders_to_sector_idTosectors:   { select: { name: true, code: true } },
          _count: { select: { order_items: true } },
        },
        orderBy: [{ created_at: 'desc' }],
        skip: pagina * POR_PAGINA,
        take: POR_PAGINA,
      }),
    ])

    return NextResponse.json(serialize({
      tipo,
      total,
      pagina,
      por_pagina: POR_PAGINA,
      rows: rows.map(r => ({
        id:           r.id,
        order_number: r.order_number,
        order_type:   r.order_type,
        status:       r.status,
        priority:     r.priority,
        started_at:   r.started_at,
        completed_at: r.completed_at,
        created_at:   r.created_at,
        notes:        r.notes,
        from_sector:  r.sectors_orders_from_sector_idTosectors,
        to_sector:    r.sectors_orders_to_sector_idTosectors,
        total_items:  r._count.order_items,
      })),
    }))

  } catch (err) {
    console.error('[GET /api/admin/pedidos]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
