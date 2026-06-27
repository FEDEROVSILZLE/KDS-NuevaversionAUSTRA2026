// app/api/admin/catalogo/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

// Convierte BigInt y Decimal a Number para que JSON.stringify no explote
function serialize(rows) {
  return JSON.parse(JSON.stringify(rows, (_, v) =>
    typeof v === 'bigint' ? Number(v) :
    (v && v.constructor && v.constructor.name === 'Decimal') ? Number(v) : v
  ))
}

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const sectorId = searchParams.get('sector_id') ? parseInt(searchParams.get('sector_id')) : null
  const buscar   = searchParams.get('buscar')?.trim() || ''
  const alertas  = searchParams.get('alertas') === 'true'

  // Modo alertas: solo productos BAJO reorden, todos los sectores
  // Usa stock_detailed (vista SQL que ya calcula stock_status)
  // Valores reales de stock_status: 'BAJO' | 'EXCESO' | 'OK'
  // Nota: la vista filtra filas con quantity=0 y sin reorder_point, eso es correcto
  // para alertas (sin reorder_point configurado no hay alerta posible)
  if (alertas) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT
          sd.product_id,
          sd.product,
          sd.condition,
          sd.sector_id,
          sd.sector_code,
          sd.sector_name,
          sd.quantity,
          sd.unit,
          sd.min_stock,
          sd.reorder_point,
          sd.stock_status,
          sd.last_updated
        FROM operations.stock_detailed sd
        WHERE sd.stock_status = 'BAJO'
        ORDER BY sd.sector_name, sd.product
      `
      return NextResponse.json(serialize(rows))
    } catch (err) {
      console.error('[GET /api/admin/catalogo alertas]', err.message)
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }

  // Modo normal: productos del sector según supply_rules + su stock en ese sector
  // Si no hay sector elegido → lista vacía (no tiene sentido mostrar 585 sin contexto)
  if (!sectorId) {
    return NextResponse.json([])
  }

  try {
    // Partimos de supply_rules filtrado por supplier_sector_id = sectorId.
    // DISTINCT ON (p.id) por si un producto tiene varias reglas para el mismo sector.
    // LEFT JOIN a stock con sector_id = sectorId (mismo id, doble uso).
    const buscarClause = buscar
      ? Prisma.sql`AND p.official_name ILIKE ${'%' + buscar + '%'}`
      : Prisma.empty

    const rows = await prisma.$queryRaw`
      SELECT DISTINCT ON (p.official_name, p.id)
        p.id,
        p.official_name            AS nombre,
        p.base_unit                AS unidad,
        p.condition,
        p.sub_condition,
        p.codigo_tango,
        p.is_for_branches          AS para_sucursal,
        p.is_produced_in_kitchen   AS cocina,
        p.is_produced_in_fabrica   AS fabrica,
        p.is_produced_in_armado    AS armado,
        p.is_fractionable          AS fracionable,
        st.quantity                AS stock_qty,
        st.unit                    AS stock_unit,
        st.min_stock,
        st.reorder_point,
        st.last_updated,
        st.last_movement_type      AS last_movement
      FROM core.supply_rules sr
      JOIN core.products p
        ON p.id = sr.product_id
       AND p.is_active = true
      LEFT JOIN operations.stock st
        ON st.product_id = p.id
       AND st.sector_id  = ${sectorId}
      WHERE sr.supplier_sector_id = ${sectorId}
        AND sr.is_active = true
        ${buscarClause}
      ORDER BY p.official_name ASC, p.id ASC
    `

    // Calcular semáforo en JS (igual que antes)
    const resultado = rows.map(r => ({
      ...r,
      codigo_tango:  r.codigo_tango  ? Number(r.codigo_tango)  : null,
      stock_qty:     r.stock_qty     ? Number(r.stock_qty)     : null,
      min_stock:     r.min_stock     ? Number(r.min_stock)     : null,
      reorder_point: r.reorder_point ? Number(r.reorder_point) : null,
      stock_status: r.stock_qty !== null
        ? (r.reorder_point && Number(r.stock_qty) <= Number(r.reorder_point) ? 'BAJO' : 'OK')
        : null,
    }))

    return NextResponse.json(serialize(resultado))
  } catch (err) {
    console.error('[GET /api/admin/catalogo]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
