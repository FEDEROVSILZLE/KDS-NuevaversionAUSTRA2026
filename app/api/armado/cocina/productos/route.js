// app/api/armado/cocina/productos/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'ARMADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const rows = await prisma.$queryRaw`
      SELECT
        p.id            AS product_id,
        p.official_name,
        p.base_unit,
        p.condition,
        p.sub_condition
      FROM core.supply_rules sr
      JOIN core.products p ON p.id = sr.product_id
      JOIN core.sectors  s ON s.id = sr.supplier_sector_id
      WHERE s.code = 'COCINA'
        AND sr.is_active = true
      ORDER BY p.official_name
    `

    const emp   = []
    const fracc = []

    rows.forEach(p => {
      const nombre = p.official_name?.toUpperCase() || ''
      const item = {
        product_id:    p.product_id,
        product_name:  p.official_name,
        base_unit:     p.base_unit,
        condition:     p.condition,
        sub_condition: p.sub_condition,
      }
      if (nombre.startsWith('RELL.') || nombre.startsWith('RELLENO')) {
        emp.push(item)
      } else {
        fracc.push(item)
      }
    })

    return NextResponse.json({ emp, fracc })

  } catch (error) {
    console.error('Error GET /api/armado/cocina/productos:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}