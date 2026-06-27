// app/api/stock/config/route.js
// GET → lista de sectores disponibles para conteo + productos de cada sector
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const sector_id = searchParams.get('sector_id')

  try {
    // Sin sector_id → devolver lista de sectores que tienen config de conteo
    if (!sector_id) {
      const sectores = await prisma.sectors.findMany({
        where: {
          is_active: true,
          stock_count_config: { some: { is_active: true } },
        },
        select: {
          id: true, code: true, name: true,
          _count: { select: { stock_count_config: { where: { is_active: true } } } },
        },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json(sectores.map(s => ({
        id:        s.id,
        code:      s.code,
        name:      s.name,
        productos: s._count.stock_count_config,
      })))
    }

    // Con sector_id → devolver productos a contar con último conteo
    const config = await prisma.stock_count_config.findMany({
      where: { sector_id: parseInt(sector_id), is_active: true },
      include: {
        products: {
          select: { id: true, official_name: true, base_unit: true, condition: true },
        },
        // Último conteo de este producto en este sector
        sectors: false,
      },
      orderBy: { sort_order: 'asc' },
    })

    // Obtener últimos conteos para este sector
    const ultimosConteos = await prisma.stock_count.findMany({
      where: { sector_id: parseInt(sector_id) },
      select: { product_id: true, quantity: true, last_updated: true, updated_by: true },
    })
    const conteoMap = new Map(ultimosConteos.map(c => [c.product_id, c]))

    return NextResponse.json(
      config.map(c => {
        const ultimo = conteoMap.get(c.product_id)
        return {
          config_id:      c.id,
          product_id:     c.product_id,
          product_name:   c.products.official_name,
          base_unit:      c.products.base_unit,
          condition:      c.products.condition,
          sort_order:     c.sort_order,
          ultimo_conteo:  ultimo ? Number(ultimo.quantity) : null,
          ultima_fecha:   ultimo?.last_updated || null,
          ultimo_usuario: ultimo?.updated_by || null,
        }
      })
    )
  } catch (error) {
    console.error('Error cargando config stock:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
