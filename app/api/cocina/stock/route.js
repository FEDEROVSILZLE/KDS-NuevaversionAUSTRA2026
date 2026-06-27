import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'COCINA') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const sectorCocina = await prisma.sectors.findUnique({ where: { code: 'COCINA' } })

    const stock = await prisma.stock_count.findMany({
      where: { sector_id: sectorCocina.id },
      include: {
        products: {
          select: {
            official_name: true,
            condition:     true,
            sub_condition: true,
            base_unit:     true,
          },
        },
      },
      orderBy: [
        { products: { condition: 'asc' } },
        { products: { official_name: 'asc' } },
      ],
    })

    const resultado = stock.map(s => ({
      product_id:    s.product_id,
      nombre:        s.products.official_name,
      condition:     s.products.condition || 'Sin categoría',
      sub_condition: s.products.sub_condition,
      cantidad:      Number(s.quantity),
      unidad:        s.unit,
      actualizado:   s.last_updated,
      actualizado_por: s.updated_by,
    }))

    return NextResponse.json(resultado)

  } catch (error) {
    console.error('Error GET /api/cocina/stock:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}