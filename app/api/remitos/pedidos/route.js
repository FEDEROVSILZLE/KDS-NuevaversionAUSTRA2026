// app/api/remitos/pedidos/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'REMITOS') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha')
  const fechaFiltro = fecha ? new Date(fecha) : null

  try {
    const items = await prisma.branch_order_items.findMany({
      where: {
        item_status: 'READY_FOR_PICKUP',
        branch_orders: {
          is_active: true,
          status: { notIn: ['DISPATCHED', 'DELIVERED', 'CANCELLED'] },
          ...(fechaFiltro && { requested_delivery_date: fechaFiltro }),
        },
      },
      include: {
        products: {
          select: { id: true, official_name: true, base_unit: true, codigo_tango: true },
        },
        branch_orders: {
          select: {
            id: true, order_number: true, branch_code: true,
            branch_name: true, requested_delivery_date: true, priority: true,
          },
        },
        shipment_items: {
          include: {
            shipments: { select: { id: true, shipment_number: true, status: true } },
          },
          take: 1,
        },
      },
      orderBy: [
        { branch_orders: { priority: 'asc' } },
        { branch_orders: { branch_code: 'asc' } },
      ],
    })

    const porSucursal = {}
    items.forEach(item => {
      const branch = item.branch_orders.branch_code
      if (!porSucursal[branch]) {
        porSucursal[branch] = {
          branch_code: branch, branch_name: item.branch_orders.branch_name || branch,
          order_number: item.branch_orders.order_number, order_id: item.branch_orders.id,
          delivery_date: item.branch_orders.requested_delivery_date,
          tiene_remito: false, remito_number: null, remito_status: null, items: [],
        }
      }
      const shipment = item.shipment_items[0]?.shipments
      if (shipment) {
        porSucursal[branch].tiene_remito  = true
        porSucursal[branch].remito_number = shipment.shipment_number
        porSucursal[branch].remito_status = shipment.status
      }
      porSucursal[branch].items.push({
        id: item.id, product_id: item.product_id,
        product_name: item.products.official_name,
        codigo_tango: item.products.codigo_tango ? String(item.products.codigo_tango) : '',
        confirmed_quantity: Number(item.confirmed_quantity || item.requested_quantity),
        unit: item.unit,
      })
    })

    return NextResponse.json(
      Object.values(porSucursal).sort((a, b) => a.branch_code.localeCompare(b.branch_code))
    )
  } catch (error) {
    console.error('Error cargando remitos:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'REMITOS') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { order_id, branch_code, items } = await request.json()
    if (!order_id || !items?.length) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    const shipment = await prisma.$transaction(async (tx) => {
      const newShipment = await tx.shipments.create({
        data: {
          shipment_number: `REM-TEMP-${Date.now()}`,
          shipment_type: 'STANDARD',
          branch_order_id: order_id,
          branch_code,
          status: 'PRINTED',
          created_by: session.user.name || 'REMITOS',
          shipment_items: {
            create: items.map(item => ({
              branch_order_item_id: item.item_id,
              product_id:           item.product_id,
              quantity_shipped:     item.quantity,
              unit:                 item.unit,
            })),
          },
        },
        select: { id: true, shipment_number: true },
      })

      await tx.branch_orders.update({
        where: { id: order_id },
        data:  { status: 'DISPATCHED' },
      })

      await tx.branch_order_items.updateMany({
        where: { id: { in: items.map(i => i.item_id) } },
        data:  { item_status: 'DISPATCHED' },
      })

      return newShipment
    })

    return NextResponse.json({ ok: true, shipment_number: shipment.shipment_number })
  } catch (error) {
    console.error('Error generando remito:', error)
    return NextResponse.json({ error: 'Error al generar remito' }, { status: 500 })
  }
}
