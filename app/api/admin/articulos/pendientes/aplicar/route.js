// app/api/admin/articulos/pendientes/aplicar/route.js
// POST → aplica TODOS los PENDING en transacciones individuales atómicas
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { applyPendingProductChanges } from '@/lib/applyPendingProductChanges'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const result = await applyPendingProductChanges()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[POST /api/admin/articulos/pendientes/aplicar]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
