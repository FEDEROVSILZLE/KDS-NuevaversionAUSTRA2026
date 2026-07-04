// app/api/admin/articulos/pendientes/route.js
// GET → lista de cambios PENDING (con nombre actual del producto y payload propuesto)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

function serialize(data) {
  return JSON.parse(JSON.stringify(data, (_, v) =>
    typeof v === 'bigint' ? Number(v) :
    (v?.constructor?.name === 'Decimal') ? Number(v) : v
  ))
}

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const rows = await prisma.$queryRaw`
      SELECT
        pc.id,
        pc.product_id,
        p.official_name AS product_name,
        p.is_active     AS product_active,
        pc.payload,
        pc.status,
        pc.created_by,
        pc.created_at
      FROM core.product_pending_changes pc
      JOIN core.products p ON p.id = pc.product_id
      WHERE pc.status = 'PENDING'
      ORDER BY pc.created_at DESC
    `
    return NextResponse.json(serialize(rows))
  } catch (err) {
    console.error('[GET /api/admin/articulos/pendientes]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
