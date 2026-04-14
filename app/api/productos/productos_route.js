// app/api/productos/route.js
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const subCondicion = searchParams.get('sub_condition')

  try {
    const productos = await prisma.products.findMany({
      where: {
        is_active: true,
        is_for_branches: true,
        ...(subCondicion ? { sub_condition: subCondicion } : {}),
      },
      select: {
        id: true,
        official_name: true,
        base_unit: true,
        condition: true,
        sub_condition: true,
      },
      orderBy: { official_name: 'asc' },
    })
    return NextResponse.json(productos)
  } catch (err) {
    console.error('GET /api/productos:', err)
    return NextResponse.json({ error: 'Error al cargar productos' }, { status: 500 })
  }
}
