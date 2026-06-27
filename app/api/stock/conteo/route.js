// app/api/stock/conteo/route.js
// POST → guardar conteo físico + disparar alerta si hay productos en 0
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { enviarAlertaStockBajo } from '@/lib/stock_alert'

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const { sector_id, conteos } = await request.json()
    // conteos: [{ product_id, quantity, unit, product_name }]

    if (!sector_id || !conteos?.length) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    // Upsert de cada conteo
    await prisma.$transaction(
      conteos.map(c =>
        prisma.stock_count.upsert({
          where: {
            sector_id_product_id: {
              sector_id:  parseInt(sector_id),
              product_id: c.product_id,
            },
          },
          update: {
            quantity:     c.quantity,
            unit:         c.unit,
            last_updated: new Date(),
            updated_by:   session.user.name || session.user.sector,
          },
          create: {
            sector_id:    parseInt(sector_id),
            product_id:   c.product_id,
            quantity:     c.quantity,
            unit:         c.unit,
            updated_by:   session.user.name || session.user.sector,
          },
        })
      )
    )

    // ── Detectar productos en 0 y enviar alerta ───────────────────────────
    const productosEnCero = conteos.filter(c => Number(c.quantity) === 0)

    let alertaResultado = null
    if (productosEnCero.length > 0) {
      // Obtener nombre del sector
      const sector = await prisma.sectors.findUnique({
        where: { id: parseInt(sector_id) },
        select: { name: true },
      })

      alertaResultado = await enviarAlertaStockBajo({
        sector:    sector?.name || `Sector ${sector_id}`,
        productos: productosEnCero.map(p => ({
          product_name: p.product_name,
          quantity:     p.quantity,
          unit:         p.unit,
        })),
        usuario: session.user.name || session.user.sector,
      })
    }

    return NextResponse.json({
      ok:               true,
      guardados:        conteos.length,
      productos_en_0:   productosEnCero.length,
      alerta:           alertaResultado,
    })

  } catch (error) {
    console.error('Error guardando conteo:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}
