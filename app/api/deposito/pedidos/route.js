// app/api/deposito/pedidos/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'DEPOSITO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha')

  try {
    const sectorDeposito = await prisma.sectors.findUnique({
      where: { code: 'DEPOSITO' },
    })

    // Usar fecha recibida o mañana por defecto
    const fechaFiltro = fecha
      ? new Date(fecha + 'T23:59:59')
      : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23,59,59); return d })()

    const items = await prisma.branch_order_items.findMany({
      where: {
        assigned_sector_id: sectorDeposito.id,
        item_status: { in: ['PENDING_CONFIRMATION', 'IN_PRODUCTION'] },
        branch_orders: {
          is_active: true,
          // ★ lte: muestra pedidos pendientes de esa fecha y días anteriores
          requested_delivery_date: { lte: fechaFiltro },
        },
      },
      include: {
        products: {
          select: {
            id: true,
            official_name: true,
            base_unit: true,
            sub_condition: true,
            condition: true,
          },
        },
        branch_orders: {
          select: {
            id: true,
            order_number: true,
            branch_code: true,
            branch_name: true,
            requested_delivery_date: true,
            priority: true,
            notes: true,
          },
        },
      },
      orderBy: [
        { branch_orders: { priority: 'asc' } },
        { branch_orders: { requested_delivery_date: 'asc' } },
        { branch_orders: { branch_code: 'asc' } },
      ],
    })

    // Agrupar por sucursal
    const porSucursal = {}
    const totalMap = {}

    items.forEach(item => {
      const branch = item.branch_orders.branch_code
      const nombre = item.branch_orders.branch_name || branch

      if (!porSucursal[branch]) {
        porSucursal[branch] = {
          branch_code:   branch,
          branch_name:   nombre,
          delivery_date: item.branch_orders.requested_delivery_date,
          priority:      item.branch_orders.priority,
          notes:         item.branch_orders.notes,
          items:         [],
        }
      }

      porSucursal[branch].items.push({
        id:                 item.id,
        product_id:         item.product_id,
        product_name:       item.products.official_name,
        sub_condition:      item.products.sub_condition,
        condition:          item.products.condition,
        requested_quantity: Number(item.requested_quantity),
        confirmed_quantity: item.confirmed_quantity ? Number(item.confirmed_quantity) : null,
        unit:               item.unit,
        item_status:        item.item_status,
      })

      if (!totalMap[item.product_id]) {
        totalMap[item.product_id] = {
          product_id:      item.product_id,
          product_name:    item.products.official_name,
          sub_condition:   item.products.sub_condition,
          unit:            item.unit,
          total_requested: 0,
          total_confirmed: 0,
        }
      }
      totalMap[item.product_id].total_requested += Number(item.requested_quantity)
      if (item.confirmed_quantity) {
        totalMap[item.product_id].total_confirmed += Number(item.confirmed_quantity)
      }
    })

    return NextResponse.json({
      por_sucursal: Object.values(porSucursal).sort((a, b) => a.branch_code.localeCompare(b.branch_code)),
      total:        Object.values(totalMap).sort((a, b) => a.product_name.localeCompare(b.product_name)),
    })

  } catch (error) {
    console.error('Error cargando pedidos de Depósito:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'DEPOSITO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { confirmaciones } = await request.json()

    if (!confirmaciones?.length) {
      return NextResponse.json({ error: 'Sin confirmaciones' }, { status: 400 })
    }

    const listos = confirmaciones.filter(c => c.listo)
    if (!listos.length) {
      return NextResponse.json({ error: 'Sin items marcados como listos' }, { status: 400 })
    }

    await prisma.$transaction(
      listos.map(c =>
        prisma.branch_order_items.update({
          where: { id: c.item_id },
          data: {
            confirmed_quantity: c.confirmed_quantity,
            item_status:        'READY_FOR_PICKUP',
            confirmed_by:       session.user.name || 'DEPOSITO',
            confirmed_at:       new Date(),
          },
        })
      )
    )

    return NextResponse.json({ ok: true, confirmados: listos.length })

  } catch (error) {
    console.error('Error confirmando items de Depósito:', error)
    return NextResponse.json({ error: 'Error al confirmar' }, { status: 500 })
  }
}
