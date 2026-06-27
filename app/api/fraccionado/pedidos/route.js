// app/api/fraccionado/pedidos/route.js
// Idéntico a Depósito pero para sector FRACCIONADO
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'FRACCIONADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha')

  try {
    const sector = await prisma.sectors.findUnique({ where: { code: 'FRACCIONADO' } })
    const fechaFiltro = fecha ? new Date(fecha) : null

    const items = await prisma.branch_order_items.findMany({
      where: {
        assigned_sector_id: sector.id,
        item_status: { in: ['PENDING_CONFIRMATION', 'IN_PRODUCTION'] },
        branch_orders: {
          is_active: true,
          ...(fechaFiltro && { requested_delivery_date: fechaFiltro }),
        },
      },
      include: {
        products: {
          select: { id: true, official_name: true, base_unit: true, sub_condition: true },
        },
        branch_orders: {
          select: {
            id: true, order_number: true, branch_code: true, branch_name: true,
            requested_delivery_date: true, priority: true,
          },
        },
      },
      orderBy: [
        { branch_orders: { priority: 'asc' } },
        { branch_orders: { branch_code: 'asc' } },
      ],
    })

    const porSucursal = {}
    const totalMap = {}

    items.forEach(item => {
      const branch = item.branch_orders.branch_code
      if (!porSucursal[branch]) {
        porSucursal[branch] = {
          branch_code:   branch,
          branch_name:   item.branch_orders.branch_name || branch,
          delivery_date: item.branch_orders.requested_delivery_date,
          items:         [],
        }
      }
      porSucursal[branch].items.push({
        id:                 item.id,
        product_id:         item.product_id,
        product_name:       item.products.official_name,
        sub_condition:      item.products.sub_condition,
        requested_quantity: Number(item.requested_quantity),
        confirmed_quantity: item.confirmed_quantity ? Number(item.confirmed_quantity) : null,
        unit:               item.unit,
        item_status:        item.item_status,
      })
      if (!totalMap[item.product_id]) {
        totalMap[item.product_id] = {
          product_id: item.product_id, product_name: item.products.official_name,
          unit: item.unit, total_requested: 0, total_confirmed: 0,
        }
      }
      totalMap[item.product_id].total_requested += Number(item.requested_quantity)
      if (item.confirmed_quantity) totalMap[item.product_id].total_confirmed += Number(item.confirmed_quantity)
    })

    return NextResponse.json({
      por_sucursal: Object.values(porSucursal).sort((a, b) => a.branch_code.localeCompare(b.branch_code)),
      total:        Object.values(totalMap).sort((a, b) => a.product_name.localeCompare(b.product_name)),
    })
  } catch (error) {
    console.error('Error pedidos Fraccionado:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'FRACCIONADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const { confirmaciones } = await request.json()
    const listos = confirmaciones?.filter(c => c.listo) || []
    if (!listos.length) return NextResponse.json({ error: 'Sin items' }, { status: 400 })

    await prisma.$transaction(
      listos.map(c => prisma.branch_order_items.update({
        where: { id: c.item_id },
        data: {
          confirmed_quantity: c.confirmed_quantity,
          item_status:        'READY_FOR_PICKUP',
          confirmed_by:       session.user.name || 'FRACCIONADO',
          confirmed_at:       new Date(),
        },
      }))
    )
    return NextResponse.json({ ok: true, confirmados: listos.length })
  } catch (error) {
    console.error('Error confirmando Fraccionado:', error)
    return NextResponse.json({ error: 'Error al confirmar' }, { status: 500 })
  }
}
