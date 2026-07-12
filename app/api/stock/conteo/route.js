// app/api/stock/conteo/route.js
// POST → guardar conteo físico + reflejar en operations.stock + registrar movimiento + alerta si hay productos en 0
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { enviarAlertaStockBajo } from '@/lib/stock_alert'

const LIMITE_DECIMAL = 9999999.999

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const { sector_id, conteos } = await request.json()
    // conteos: [{ product_id, quantity, unit, product_name }]

    if (!sector_id || !conteos?.length) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    const sectorIdInt = parseInt(sector_id)
    const usuario = session.user.name || session.user.sector

    // ── Sanitizar y validar cantidades ANTES de tocar la DB ──────────────
    const conteosLimpios = []
    const invalidos = []

    for (const c of conteos) {
      const cantidad = parseFloat(c.quantity)

      if (
        c.quantity === null ||
        c.quantity === undefined ||
        c.quantity === '' ||
        isNaN(cantidad) ||
        Math.abs(cantidad) >= LIMITE_DECIMAL
      ) {
        invalidos.push({
          product_id: c.product_id,
          product_name: c.product_name,
          quantity_recibida: c.quantity,
        })
        continue
      }

      conteosLimpios.push({ ...c, quantity: cantidad })
    }

    if (invalidos.length > 0) {
      console.error('CONTEOS INVÁLIDOS (rechazados):', JSON.stringify(invalidos, null, 2))
      return NextResponse.json(
        {
          error: 'Algunos productos tienen cantidades inválidas o fuera de rango',
          invalidos,
        },
        { status: 400 }
      )
    }

    await prisma.$transaction(async (tx) => {
      for (const c of conteosLimpios) {
        // 1. Guardar el conteo (histórico / borrador de conteo físico)
        await tx.stock_count.upsert({
          where: {
            sector_id_product_id: {
              sector_id: sectorIdInt,
              product_id: c.product_id,
            },
          },
          update: {
            quantity: c.quantity,
            unit: c.unit,
            last_updated: new Date(),
            updated_by: usuario,
          },
          create: {
            sector_id: sectorIdInt,
            product_id: c.product_id,
            quantity: c.quantity,
            unit: c.unit,
            updated_by: usuario,
          },
        })

        // 2. Leer el stock actual ANTES de pisarlo (para saber si cambió algo)
        const [prev] = await tx.$queryRaw`
          SELECT quantity FROM operations.stock
          WHERE sector_id = ${sectorIdInt} AND product_id = ${c.product_id}::uuid
        `
        const stockAntes = prev?.quantity != null ? Number(prev.quantity) : null

        // 3. Reflejar el conteo real en operations.stock + registrar el movimiento en
        //    stock_movements — todo vía operations.update_stock(), que además calcula
        //    quantity_units automáticamente si el producto tiene conversion_factor.
        //    Solo si el conteo realmente cambió el stock — evita ruido por re-guardar el mismo valor.
        if (stockAntes === null || stockAntes !== c.quantity) {
          const delta = c.quantity - (stockAntes ?? 0)
          await tx.$executeRaw`
            SELECT operations.update_stock(
              ${sectorIdInt}::integer,
              ${c.product_id}::uuid,
              ${delta}::numeric,
              'AJUSTE'::operations.movement_type,
              NULL::uuid,
              'stock_count'::varchar,
              ${usuario}::varchar,
              'Ajuste por conteo físico'::text
            )
          `
        }
      }
    })

    // ── Detectar productos en 0 y enviar alerta ───────────────────────────
    const productosEnCero = conteosLimpios.filter(c => Number(c.quantity) === 0)

    let alertaResultado = null
    if (productosEnCero.length > 0) {
      const sector = await prisma.sectors.findUnique({
        where: { id: sectorIdInt },
        select: { name: true },
      })

      alertaResultado = await enviarAlertaStockBajo({
        sector: sector?.name || `Sector ${sector_id}`,
        productos: productosEnCero.map(p => ({
          product_name: p.product_name,
          quantity: p.quantity,
          unit: p.unit,
        })),
        usuario,
      })
    }

    return NextResponse.json({
      ok: true,
      guardados: conteosLimpios.length,
      productos_en_0: productosEnCero.length,
      alerta: alertaResultado,
    })

  } catch (error) {
    console.error('Error guardando conteo:', error)
    return NextResponse.json({ error: 'Error al guardar', detalle: error.message }, { status: 500 })
  }
}
