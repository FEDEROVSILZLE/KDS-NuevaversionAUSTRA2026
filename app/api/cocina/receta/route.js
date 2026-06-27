import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'COCINA') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const product_id = searchParams.get('product_id')
  const quantity   = parseFloat(searchParams.get('quantity') || '1')

  if (!product_id) {
    return NextResponse.json({ error: 'product_id requerido' }, { status: 400 })
  }

  try {
    const receta = await prisma.recipes.findFirst({
      where: { product_id, is_active: true },
      include: {
        recipe_ingredients: {
          include: {
            products: { select: { official_name: true, base_unit: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    })

    if (!receta) {
      return NextResponse.json({ sinReceta: true, ingredientes: [] })
    }

    const ingredientes = receta.recipe_ingredients.map(ing => ({
      nombre:   ing.products.official_name,
      cantidad: Number(
        ((Number(ing.quantity) * quantity) / Number(receta.yield_quantity)).toFixed(3)
      ),
      unidad:   ing.unit,
      opcional: ing.is_optional,
    }))

    return NextResponse.json({ sinReceta: false, ingredientes })

  } catch (error) {
    console.error('Error GET /api/cocina/receta:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}