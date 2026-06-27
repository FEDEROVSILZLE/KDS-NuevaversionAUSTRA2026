// app/api/admin/sectores/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const sectores = await prisma.sectors.findMany({
      where: { is_active: true },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(sectores)
  } catch (err) {
    console.error('[GET /api/admin/sectores]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
