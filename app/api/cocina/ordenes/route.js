import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'COCINA') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const sectorCocina = await prisma.sectors.findUnique({ where: { code: 'COCINA' } })

    const items = await prisma.order_items.findMany({
      where: {
        item_status: { in: ['PENDING_CONFIRMATION', 'IN_PRODUCTION', 'READY_FOR_PICKUP'] },
        orders: {
          to_sector_id: sectorCocina.id,
          is_active: true,
          order_type: 'PRODUCTION_ORDER',
        },
      },
      include: {
        products: {
          select: {
            id: true,
            official_name: true,
            base_unit: true,
            sub_condition: true,
          },
        },
        orders: {
          select: {
            order_number: true,
            from_sector_id: true,
            sectors_orders_from_sector_idTosectors: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [
        { orders: { priority: 'asc' } },
        { created_at: 'asc' },
      ],
    })

    // Separar en emp (rellenos) y fracc (fraccionados)
    const EMP_SUBCONDITIONS = ['horno', 'freir', 'semillas', 'hojaldre', 'copetin']

    const emp  = []
    const fracc = []

    items.forEach(item => {
      const subCond = item.products.sub_condition?.toLowerCase() || ''
      const mapped = {
        id:                 item.id,
        product_id:         item.product_id,
        product_name:       item.products.official_name,
        sub_condition:      subCond,
        requested_quantity: Number(item.requested_quantity),
        produced_quantity:  item.produced_quantity ? Number(item.produced_quantity) : null,
        unit:               item.unit,
        item_status:        item.item_status,
        origen_sector:      item.orders.sectors_orders_from_sector_idTosectors?.name || null,
        order_number:       item.orders.order_number,
      }

      if (EMP_SUBCONDITIONS.includes(subCond)) {
        emp.push(mapped)
      } else {
        fracc.push(mapped)
      }
    })

    return NextResponse.json({ emp, fracc })

  } catch (error) {
    console.error('Error GET /api/cocina/ordenes:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'COCINA') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { item_id, produced_quantity } = await request.json()

    if (!item_id || produced_quantity === undefined) {
      return NextResponse.json({ error: 'item_id y produced_quantity requeridos' }, { status: 400 })
    }

    await prisma.order_items.update({
      where: { id: item_id },
      data: {
        produced_quantity:       produced_quantity,
        confirmed_quantity:      produced_quantity,
        item_status:             'READY_FOR_PICKUP',
        confirmed_by:            session.user.name || 'COCINA',
        confirmed_at:            new Date(),
        production_completed_at: new Date(),
      },
    })

    return NextResponse.json({ ok: true })

  } catch (error) {
    console.error('Error POST /api/cocina/ordenes:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}