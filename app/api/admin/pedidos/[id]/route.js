// app/api/admin/pedidos/[id]/route.js
// GET ?entity_type=branch_order|internal_order
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

export async function GET(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const entityType = searchParams.get('entity_type') || 'branch_order'

  try {
    // ── Historial de estados (audit) ──────────────────────────────────────
    // entity_type real: 'branch_order' | 'internal_order' (verificado en triggers)
    const historia = await prisma.$queryRaw`
      SELECT
        changed_at,
        previous_status,
        new_status,
        changed_by,
        notes,
        metadata
      FROM audit.get_entity_history(${entityType}, ${id}::uuid)
      ORDER BY changed_at ASC
    `

    // ── Detalle del pedido ────────────────────────────────────────────────
    if (entityType === 'branch_order') {
      const pedido = await prisma.branch_orders.findUnique({
        where: { id },
        include: {
          branch_order_items: {
            include: {
              products: { select: { official_name: true, base_unit: true } },
              sectors:  { select: { name: true, code: true } },
            },
            orderBy: { created_at: 'asc' },
          },
        },
      })
      if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })

      return NextResponse.json(serialize({
        pedido: {
          id:                      pedido.id,
          order_number:            pedido.order_number,
          branch_code:             pedido.branch_code,
          branch_name:             pedido.branch_name,
          status:                  pedido.status,
          requested_delivery_date: pedido.requested_delivery_date,
          priority:                pedido.priority,
          notes:                   pedido.notes,
          created_at:              pedido.created_at,
          items: pedido.branch_order_items.map(i => ({
            id:                 i.id,
            producto:           i.products.official_name,
            unidad:             i.unit,
            pedido:             Number(i.requested_quantity),
            confirmado:         i.confirmed_quantity ? Number(i.confirmed_quantity) : null,
            estado:             i.item_status,
            sector:             i.sectors?.name ?? '—',
            confirmed_at:       i.confirmed_at,
            confirmed_by:       i.confirmed_by,
          })),
        },
        historia: serialize(historia),
      }))
    }

    // ── Orden interna ─────────────────────────────────────────────────────
    const orden = await prisma.orders.findUnique({
      where: { id },
      include: {
        sectors_orders_from_sector_idTosectors: { select: { name: true, code: true } },
        sectors_orders_to_sector_idTosectors:   { select: { name: true, code: true } },
        order_items: {
          include: {
            products: { select: { official_name: true, base_unit: true } },
          },
          orderBy: { created_at: 'asc' },
        },
      },
    })
    if (!orden) return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })

    return NextResponse.json(serialize({
      pedido: {
        id:           orden.id,
        order_number: orden.order_number,
        order_type:   orden.order_type,
        status:       orden.status,
        priority:     orden.priority,
        from_sector:  orden.sectors_orders_from_sector_idTosectors,
        to_sector:    orden.sectors_orders_to_sector_idTosectors,
        started_at:   orden.started_at,
        completed_at: orden.completed_at,
        created_at:   orden.created_at,
        notes:        orden.notes,
        items: orden.order_items.map(i => ({
          id:          i.id,
          producto:    i.products.official_name,
          unidad:      i.unit,
          pedido:      Number(i.requested_quantity),
          confirmado:  i.confirmed_quantity ? Number(i.confirmed_quantity) : null,
          producido:   i.produced_quantity   ? Number(i.produced_quantity)  : null,
          estado:      i.item_status,
          started_at:  i.production_started_at,
          completed_at: i.production_completed_at,
        })),
      },
      historia: serialize(historia),
    }))

  } catch (err) {
    console.error('[GET /api/admin/pedidos/[id]]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
