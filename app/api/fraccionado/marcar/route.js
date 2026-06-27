// app/api/fraccionado/marcar/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function PATCH(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'FRACCIONADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const { item_id, marcado, cantidad } = await request.json()
    if (!item_id) return NextResponse.json({ error: 'item_id requerido' }, { status: 400 })

    const item = await prisma.branch_order_items.findUnique({
      where: { id: item_id },
      select: { item_status: true, requested_quantity: true },
    })
    if (!item) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (item.item_status === 'READY_FOR_PICKUP') return NextResponse.json({ ok: true, skipped: true })

    await prisma.branch_order_items.update({
      where: { id: item_id },
      data: {
        item_status:        marcado ? 'IN_PRODUCTION' : 'PENDING_CONFIRMATION',
        confirmed_quantity: marcado ? (cantidad ?? item.requested_quantity) : null,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error marcando Fraccionado:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
