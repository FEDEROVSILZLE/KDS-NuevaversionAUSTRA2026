// app/api/remitos/retiros/route.js
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

  try {
    const inicio = fecha ? new Date(fecha) : new Date()
    inicio.setHours(0, 0, 0, 0)
    const fin = new Date(inicio)
    fin.setHours(23, 59, 59, 999)

    const retiros = await prisma.shipments.findMany({
      where: {
        shipment_type: 'EXPRESS_PICKUP',
        created_at: { gte: inicio, lte: fin },
        status: { notIn: ['CANCELLED'] },
      },
      include: {
        shipment_items: {
          include: {
            products: { select: { official_name: true, codigo_tango: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    return NextResponse.json(
      retiros.map(r => ({
        id: r.id, shipment_number: r.shipment_number,
        branch_code: r.branch_code, status: r.status, created_at: r.created_at,
        items: r.shipment_items.map(i => ({
          product_name:     i.products?.official_name || '',
          codigo_tango:     i.products?.codigo_tango ? String(i.products.codigo_tango) : '',
          quantity_shipped: Number(i.quantity_shipped),
          unit:             i.unit,
        })),
      }))
    )
  } catch (error) {
    console.error('Error cargando retiros:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
