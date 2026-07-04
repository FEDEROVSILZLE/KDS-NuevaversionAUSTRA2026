// app/api/admin/articulos/pendientes/[id]/route.js
// DELETE → cancelar un cambio PENDING (status = CANCELLED)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

export async function DELETE(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  try {
    const rows = await prisma.$queryRaw`
      UPDATE core.product_pending_changes
      SET status = 'CANCELLED', applied_at = NOW()
      WHERE id = ${id}::uuid AND status = 'PENDING'
      RETURNING id
    `
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Cambio pendiente no encontrado o ya procesado.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/admin/articulos/pendientes/[id]]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
