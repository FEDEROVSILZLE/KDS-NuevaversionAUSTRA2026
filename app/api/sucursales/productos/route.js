import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const sub_condition = searchParams.get('sub_condition')

    if (!sub_condition) {
      return NextResponse.json({ error: 'sub_condition es requerido' }, { status: 400 })
    }

    const productos = await prisma.products.findMany({
      where: {
        sub_condition: sub_condition,
        is_active:        true,
        is_for_branches:  true,
      },
      select: {
        id:            true,
        official_name: true,
        base_unit:     true,
        condition:     true,
        sub_condition: true,
      },
      orderBy: { official_name: 'asc' },
    })

    return NextResponse.json(productos)

  } catch (error) {
    console.error('Error /api/sucursales/productos:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}