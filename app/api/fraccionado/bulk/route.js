// app/api/fraccionado/bulk/route.js
// GET  → lotes bulk pendientes de fraccionar
// POST → ejecutar fraccionamiento de un lote (parcial o total)

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'FRACCIONADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const sector = await prisma.sectors.findUnique({ where: { code: 'FRACCIONADO' } })

    // Lotes bulk pendientes de fraccionar en el sector Fraccionado
    const lotes = await prisma.stock_lots.findMany({
      where: {
        sector_id:        sector.id,
        is_bulk_remainder: true,
        is_consumed:       false,
        expires_at:        { gte: new Date() },
      },
      include: {
        products: {
          select: {
            id: true, official_name: true, base_unit: true,
            fraction_weight_kg: true,
          },
        },
      },
      orderBy: { expires_at: 'asc' }, // primero los que vencen antes
    })

    return NextResponse.json(
      lotes.map(lot => ({
        id:                 lot.id,
        product_id:         lot.product_id,
        product_name:       lot.products.official_name,
        unit:               lot.unit,
        quantity_kg:        Number(lot.quantity_kg),
        produced_at:        lot.produced_at,
        expires_at:         lot.expires_at,
        fraction_weight_kg: lot.products.fraction_weight_kg
          ? Number(lot.products.fraction_weight_kg) : null,
        porciones_posibles: lot.products.fraction_weight_kg
          ? Math.floor(Number(lot.quantity_kg) / Number(lot.products.fraction_weight_kg))
          : null,
        dias_restantes: Math.ceil(
          (new Date(lot.expires_at) - new Date()) / (1000 * 60 * 60 * 24)
        ),
      }))
    )
  } catch (error) {
    console.error('Error cargando bulk:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'FRACCIONADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { lot_id, kg_a_fraccionar } = await request.json()

    if (!lot_id || !kg_a_fraccionar || kg_a_fraccionar <= 0) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    // Obtener el lote y el producto
    const lot = await prisma.stock_lots.findUnique({
      where: { id: lot_id },
      include: { products: true },
    })

    if (!lot) return NextResponse.json({ error: 'Lote no encontrado' }, { status: 404 })
    if (lot.is_consumed) return NextResponse.json({ error: 'Lote ya consumido' }, { status: 400 })
    if (!lot.products.fraction_weight_kg) {
      return NextResponse.json({ error: 'Producto sin peso de porción definido' }, { status: 400 })
    }

    const kgDisponible    = Number(lot.quantity_kg)
    const fraccionPeso    = Number(lot.products.fraction_weight_kg)
    const kgAFraccionar   = Math.min(Number(kg_a_fraccionar), kgDisponible)
    const porciones       = Math.floor(kgAFraccionar / fraccionPeso)
    const kgUsado         = porciones * fraccionPeso
    const kgResto         = kgDisponible - kgUsado
    const esFraccionTotal = kgAFraccionar >= kgDisponible - 0.001

    await prisma.$transaction(async (tx) => {
      // Marcar lote original como consumido
      await tx.stock_lots.update({
        where: { id: lot_id },
        data: { is_consumed: true, consumed_at: new Date() },
      })

      // Crear porciones fraccionadas (heredan fecha original)
      if (porciones > 0) {
        await tx.stock_lots.createMany({
          data: Array.from({ length: porciones }, () => ({
            sector_id:         lot.sector_id,
            product_id:        lot.product_id,
            origin_order_id:   lot.origin_order_id,
            quantity_kg:       fraccionPeso,
            unit:              lot.unit,
            produced_at:       lot.produced_at,
            expires_at:        lot.expires_at,
            is_bulk_remainder: false,
            created_by:        session.user.name || 'FRACCIONADO',
          })),
        })
      }

      // Si no se fraccionó todo, crear un nuevo lote de resto
      if (kgResto > 0.001) {
        await tx.stock_lots.create({
          data: {
            sector_id:         lot.sector_id,
            product_id:        lot.product_id,
            origin_order_id:   lot.origin_order_id,
            quantity_kg:       kgResto,
            unit:              lot.unit,
            produced_at:       lot.produced_at,
            expires_at:        lot.expires_at,
            is_bulk_remainder: true,
            created_by:        session.user.name || 'FRACCIONADO',
            notes:             'Resto de fraccionamiento',
          },
        })
      }
    })

    return NextResponse.json({
      ok:        true,
      porciones,
      kg_usado:  kgUsado,
      kg_resto:  kgResto,
      fue_total: esFraccionTotal,
    })

  } catch (error) {
    console.error('Error fraccionando:', error)
    return NextResponse.json({ error: 'Error al fraccionar' }, { status: 500 })
  }
}
