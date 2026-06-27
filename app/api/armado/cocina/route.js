// app/api/armado/cocina/route.js
// POST → Armado crea una PRODUCTION_ORDER hacia Cocina

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'ARMADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { items, fecha_entrega, notas } = await request.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Debe incluir al menos un producto' }, { status: 400 })
    }

    const itemsValidos = items.filter(i => Number(i.quantity) > 0)
    if (itemsValidos.length === 0) {
      return NextResponse.json({ error: 'Ingresá al menos una cantidad mayor a 0' }, { status: 400 })
    }

    const sectorCocina = await prisma.sectors.findUnique({ where: { code: 'COCINA' } })
    const sectorArmado = await prisma.sectors.findUnique({ where: { code: 'ARMADO' } })

    const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const count = await prisma.orders.count({
      where: {
        order_type: 'PRODUCTION_ORDER',
        created_at: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    })
    const orderNumber = `PROD-${hoy}-${String(count + 1).padStart(3, '0')}`

    const orden = await prisma.$transaction(async (tx) => {
      const nuevaOrden = await tx.orders.create({
        data: {
          order_number:            orderNumber,
          order_type:              'PRODUCTION_ORDER',
          from_sector_id:          sectorArmado.id,
          to_sector_id:            sectorCocina.id,
          status:                  'PENDING_CONFIRMATION',
          priority:                1,
          notes:                   notas || null,
          created_by:              session.user.name || 'ARMADO',
          requested_delivery_date: fecha_entrega ? new Date(fecha_entrega) : null,
          is_active:               true,
        },
      })

      await tx.order_items.createMany({
        data: itemsValidos.map(item => ({
          order_id:           nuevaOrden.id,
          product_id:         item.product_id,
          requested_quantity: Number(item.quantity),
          unit:               item.unit || 'KG',
          item_status:        'PENDING_CONFIRMATION',
        })),
      })

      return nuevaOrden
    })

    return NextResponse.json({
      ok:           true,
      order_number: orden.order_number,
      items_count:  itemsValidos.length,
    })

  } catch (error) {
    console.error('Error POST /api/armado/cocina:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
