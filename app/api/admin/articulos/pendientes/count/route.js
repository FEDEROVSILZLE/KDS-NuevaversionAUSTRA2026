// app/api/admin/articulos/pendientes/count/route.js
// GET → { count: N }  (fetch barato para el badge del menú)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const [row] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM core.product_pending_changes
      WHERE status = 'PENDING'
    `
    return NextResponse.json({ count: row.count ?? 0 })
  } catch (err) {
    // Si la tabla todavía no existe (antes de correr el SQL) devuelve 0 sin crashear
    if (err.message?.includes('product_pending_changes')) {
      return NextResponse.json({ count: 0 })
    }
    console.error('[GET /api/admin/articulos/pendientes/count]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
