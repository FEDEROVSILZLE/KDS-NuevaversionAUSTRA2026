// lib/produccionDiaria.js
// Lógica compartida de "Producción del día" para Fábrica, Armado y Fraccionado.
// V1: solo queda registrado en operations.production_logs (+ inputs/outputs).
// NO toca operations.stock todavía — es la versión digital de la planilla de
// papel RC-7397-2. Conectarlo a stock real (vía operations.update_stock) queda
// para una siguiente etapa, una vez que se probó en uso real.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

const FLAG_PRODUCTO_POR_SECTOR = {
  FABRICA:     'is_produced_in_fabrica',
  ARMADO:      'is_produced_in_armado',
  FRACCIONADO: 'is_produced_in_fraccionado',
}

function fechaHoyAR() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export async function getProduccionDiaria(request, sectorCode) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== sectorCode) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha') || fechaHoyAR()

  try {
    const sector = await prisma.sectors.findUnique({ where: { code: sectorCode } })
    if (!sector) return NextResponse.json({ error: `Sector ${sectorCode} no configurado` }, { status: 500 })

    const flagProducido = FLAG_PRODUCTO_POR_SECTOR[sectorCode]

    const [productosSector, productosInsumo, log] = await Promise.all([
      prisma.products.findMany({
        where: { is_active: true, [flagProducido]: true },
        select: { id: true, official_name: true, base_unit: true },
        orderBy: { official_name: 'asc' },
      }),
      prisma.products.findMany({
        where: { is_active: true, condition: { in: ['MATERIA PRIMA', 'INSUMO'] } },
        select: { id: true, official_name: true, base_unit: true },
        orderBy: { official_name: 'asc' },
      }),
      prisma.production_logs.findUnique({
        where: { sector_id_log_date: { sector_id: sector.id, log_date: new Date(fecha + 'T00:00:00Z') } },
        include: {
          production_log_inputs:  { orderBy: { sort_order: 'asc' } },
          production_log_outputs: { orderBy: { sort_order: 'asc' } },
        },
      }),
    ])

    return NextResponse.json({
      fecha,
      productos_sector: productosSector,
      productos_insumo: productosInsumo,
      notes: log?.notes || '',
      insumos: (log?.production_log_inputs || []).map(i => ({
        id:          i.id,
        product_id:  i.product_id,
        quantity:    Number(i.quantity),
        unit:        i.unit,
        brand:       i.brand || '',
        lot_code:    i.lot_code || '',
        expires_at:  i.expires_at ? i.expires_at.toISOString().split('T')[0] : '',
      })),
      producido: (log?.production_log_outputs || []).map(o => ({
        id:         o.id,
        product_id: o.product_id,
        quantity:   Number(o.quantity),
        unit:       o.unit,
      })),
    })
  } catch (error) {
    console.error(`Error cargando producción diaria (${sectorCode}):`, error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function postProduccionDiaria(request, sectorCode) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== sectorCode) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { fecha, notes, insumos, producido } = await request.json()
    if (!fecha) return NextResponse.json({ error: 'Falta la fecha' }, { status: 400 })

    const sector = await prisma.sectors.findUnique({ where: { code: sectorCode } })
    if (!sector) return NextResponse.json({ error: `Sector ${sectorCode} no configurado` }, { status: 500 })

    const usuario = session.user.name || sectorCode
    const logDate = new Date(fecha + 'T00:00:00Z')

    const insumosLimpios = (insumos || [])
      .filter(i => i.product_id && Number(i.quantity) > 0)
      .map((i, idx) => ({
        product_id:  i.product_id,
        quantity:    Number(i.quantity),
        unit:        i.unit || 'KG',
        brand:       i.brand || null,
        lot_code:    i.lot_code || null,
        expires_at:  i.expires_at ? new Date(i.expires_at + 'T00:00:00Z') : null,
        sort_order:  idx,
      }))

    const producidoLimpio = (producido || [])
      .filter(o => o.product_id && Number(o.quantity) > 0)
      .map((o, idx) => ({
        product_id: o.product_id,
        quantity:   Number(o.quantity),
        unit:       o.unit || 'KG',
        sort_order: idx,
      }))

    if (!insumosLimpios.length && !producidoLimpio.length) {
      return NextResponse.json({ error: 'Sin datos para guardar' }, { status: 400 })
    }

    const log = await prisma.$transaction(async (tx) => {
      const logHeader = await tx.production_logs.upsert({
        where: { sector_id_log_date: { sector_id: sector.id, log_date: logDate } },
        update: { notes: notes || null, updated_by: usuario, updated_at: new Date() },
        create: { sector_id: sector.id, log_date: logDate, notes: notes || null, created_by: usuario, updated_by: usuario },
      })

      // Reemplazo total de las filas de ese día (como "guardar la planilla completa" de nuevo)
      await tx.production_log_inputs.deleteMany({ where: { production_log_id: logHeader.id } })
      await tx.production_log_outputs.deleteMany({ where: { production_log_id: logHeader.id } })

      if (insumosLimpios.length) {
        await tx.production_log_inputs.createMany({
          data: insumosLimpios.map(i => ({ ...i, production_log_id: logHeader.id })),
        })
      }
      if (producidoLimpio.length) {
        await tx.production_log_outputs.createMany({
          data: producidoLimpio.map(o => ({ ...o, production_log_id: logHeader.id })),
        })
      }

      return logHeader
    })

    return NextResponse.json({
      ok: true,
      log_id: log.id,
      insumos_guardados: insumosLimpios.length,
      producido_guardado: producidoLimpio.length,
    })
  } catch (error) {
    console.error(`Error guardando producción diaria (${sectorCode}):`, error)
    return NextResponse.json({ error: 'Error al guardar', detalle: error.message }, { status: 500 })
  }
}
