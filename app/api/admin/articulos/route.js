// app/api/admin/articulos/route.js
// GET ?buscar=X  → búsqueda de productos (para modal de edición)
// POST           → crear artículo (impacto inmediato en core.products)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

const VALID_UNITS = ['KG', 'LITRO', 'UNIDAD', 'GRAMO', 'ML', 'DOCENA']

function serialize(data) {
  return JSON.parse(JSON.stringify(data, (_, v) =>
    typeof v === 'bigint' ? Number(v) :
    (v?.constructor?.name === 'Decimal') ? Number(v) : v
  ))
}

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const buscar = searchParams.get('buscar')?.trim() || ''

  if (buscar.length < 2) return NextResponse.json([])

  try {
    const rows = await prisma.products.findMany({
      where: { official_name: { contains: buscar, mode: 'insensitive' } },
      select: {
        id: true, official_name: true, base_unit: true, condition: true,
        sub_condition: true, codigo_tango: true, conversion_factor: true, description: true,
        internal_code: true, is_for_branches: true, is_produced_in_kitchen: true,
        is_produced_in_fabrica: true, is_produced_in_armado: true,
        is_fractionable: true, is_active: true,
      },
      orderBy: { official_name: 'asc' },
      take: 20,
    })
    return NextResponse.json(serialize(rows))
  } catch (err) {
    console.error('[GET /api/admin/articulos]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const {
    official_name, base_unit, condition, sub_condition, codigo_tango, conversion_factor,
    is_for_branches, is_produced_in_kitchen, is_produced_in_fabrica,
    is_produced_in_armado, is_fractionable, description, internal_code,
  } = body

  // Validaciones
  if (!official_name?.trim()) {
    return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 })
  }
  if (!base_unit || !VALID_UNITS.includes(base_unit)) {
    return NextResponse.json({ error: `Unidad inválida. Válidas: ${VALID_UNITS.join(', ')}` }, { status: 400 })
  }
  const tangoNum = (codigo_tango !== '' && codigo_tango != null)
    ? Number(codigo_tango) : null
  if (codigo_tango !== '' && codigo_tango != null && isNaN(tangoNum)) {
    return NextResponse.json({ error: 'Código Tango debe ser numérico.' }, { status: 400 })
  }
  const conversionNum = (conversion_factor !== '' && conversion_factor != null)
    ? Number(conversion_factor) : null
  if (conversion_factor !== '' && conversion_factor != null && (isNaN(conversionNum) || conversionNum <= 0)) {
    return NextResponse.json({ error: 'Factor de conversión debe ser un número mayor a 0.' }, { status: 400 })
  }

  try {
    // Verificar unicidad case-insensitive antes de INSERT (devuelve 409 más claro que el error de PG)
    const existing = await prisma.$queryRaw`
      SELECT id FROM core.products
      WHERE UPPER(TRIM(official_name)) = UPPER(TRIM(${official_name.trim()}))
      LIMIT 1
    `
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Ya existe un artículo con ese nombre.' }, { status: 409 })
    }

    const producto = await prisma.products.create({
      data: {
        official_name:          official_name.trim(),
        base_unit,
        condition:              condition      || null,
        sub_condition:          sub_condition  || null,
        codigo_tango:           tangoNum,
        conversion_factor:      conversionNum,
        is_for_branches:        is_for_branches        ?? false,
        is_produced_in_kitchen: is_produced_in_kitchen ?? false,
        is_produced_in_fabrica: is_produced_in_fabrica ?? false,
        is_produced_in_armado:  is_produced_in_armado  ?? false,
        is_fractionable:        is_fractionable        ?? false,
        description:            description    || null,
        internal_code:          internal_code  || null,
        is_active:              true,
      },
    })
    return NextResponse.json(serialize(producto), { status: 201 })
  } catch (err) {
    if (err.message?.includes('idx_products_name_unique') || err.code === 'P2002') {
      return NextResponse.json({ error: 'Ya existe un artículo con ese nombre.' }, { status: 409 })
    }
    if (err.message?.includes('products_valid_unit')) {
      return NextResponse.json({ error: 'Unidad no válida.' }, { status: 400 })
    }
    if (err.message?.includes('products_name_not_empty')) {
      return NextResponse.json({ error: 'El nombre no puede estar vacío.' }, { status: 400 })
    }
    console.error('[POST /api/admin/articulos]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
