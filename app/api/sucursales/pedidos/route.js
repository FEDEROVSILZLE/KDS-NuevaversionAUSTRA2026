// app/api/sucursales/pedidos/route.js
import { NextResponse }     from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/app/api/auth/[...nextauth]/route'
import { prisma }            from '@/lib/prisma'

// ─── POST: Crear pedido ───────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const branchCode = session.user.sector   // ej: 'LMA'
    const branchName = session.user.name     // ej: 'La Loma'

    const { items, modoRetiro, fechaEntrega } = await req.json()

    if (!items?.length) {
      return NextResponse.json({ error: 'El pedido no tiene items' }, { status: 400 })
    }

    // Fecha de entrega: mañana para fábrica, hoy para el resto
    const deliveryDate = fechaEntrega ?? new Date().toISOString().split('T')[0]

    // Número de pedido único: PED-2026-<timestamp>
    const orderNumber = `PED-${new Date().getFullYear()}-${Date.now()}`
    const notes       = modoRetiro ? 'RETIRO EXPRESS' : null

    // Para cada item, buscar qué sector lo provee (supply_rules)
    const productIds = items.map(i => i.product_id)

    const supplyRules = await prisma.supply_rules.findMany({
      where: {
        product_id: { in: productIds },
        is_default: true,
        is_active:  true,
      },
      select: {
        product_id:         true,
        supplier_sector_id: true,
      },
    })

    // Mapear product_id -> sector_id
    const sectorMap = {}
    supplyRules.forEach(r => { sectorMap[r.product_id] = r.supplier_sector_id })

    // Verificar que todos los productos tienen proveedor
    const sinProveedor = items.filter(i => !sectorMap[i.product_id])
    if (sinProveedor.length) {
      return NextResponse.json({
        error: 'Productos sin proveedor asignado en supply_rules',
        productos: sinProveedor.map(i => i.product_id),
      }, { status: 422 })
    }

    // Crear pedido + items en una sola transacción
    const order = await prisma.branch_orders.create({
      data: {
        order_number:            orderNumber,
        branch_code:             branchCode,
        branch_name:             branchName,
        status:                  'PENDING_CONFIRMATION',
        requested_delivery_date: new Date(deliveryDate),
        notes,
        created_by:              branchCode,
        branch_order_items: {
          create: items.map(i => ({
            product_id:         i.product_id,
            requested_quantity: i.cantidad,
            unit:               i.unidad,
            assigned_sector_id: sectorMap[i.product_id],
            item_status:        'PENDING_CONFIRMATION',
          })),
        },
      },
      select: { id: true, order_number: true },
    })

    return NextResponse.json({ ok: true, order_id: order.id, order_number: order.order_number }, { status: 201 })

  } catch (err) {
    const msg = err?.message ?? 'Error desconocido'
    console.error('[POST /api/sucursales/pedidos]', msg)

    // Unique constraint: mismo producto dos veces en el pedido
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'Hay productos duplicados en el pedido' }, { status: 422 })
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── GET: Items de pedidos de hoy para esta sucursal ─────────────────────────
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const branchCode = session.user.sector

    const hoyInicio = new Date()
    hoyInicio.setHours(0, 0, 0, 0)
    const hoyFin = new Date()
    hoyFin.setHours(23, 59, 59, 999)

    const orders = await prisma.branch_orders.findMany({
      where: {
        branch_code: branchCode,
        is_active:   true,
        created_at:  { gte: hoyInicio, lte: hoyFin },
      },
      include: {
        branch_order_items: {
          include: {
            products: {
              select: { official_name: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    // Aplanar al formato que espera el front: { nombre, cantidad, unidad, estado, hora }
    const rows = orders.flatMap(o =>
      o.branch_order_items.map(item => ({
        nombre:   item.products.official_name,
        cantidad: Number(item.requested_quantity),
        unidad:   item.unit,
        estado:   item.item_status,
        hora:     o.created_at
          ? new Date(o.created_at).toLocaleTimeString('es-AR', {
              hour: '2-digit', minute: '2-digit',
              timeZone: 'America/Argentina/Buenos_Aires',
            })
          : '',
      }))
    )

    return NextResponse.json(rows)

  } catch (err) {
    const msg = err?.message ?? 'Error desconocido'
    console.error('[GET /api/sucursales/pedidos]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
