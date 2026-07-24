// app/api/admin/articulos/[id]/route.js
// PUT    → encolar edición como PENDING (NO toca core.products)
// DELETE → soft-delete encolado (is_active=false como PENDING)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

const VALID_UNITS = ['KG', 'LITRO', 'UNIDAD', 'GRAMO', 'ML', 'DOCENA']

async function upsertPending(productId, payload, createdBy) {
  // Upsert: si ya hay PENDING para este producto, reemplaza el payload completo
  await prisma.$queryRaw`
    INSERT INTO core.product_pending_changes (product_id, payload, status, created_by)
    VALUES (${productId}::uuid, ${JSON.stringify(payload)}::jsonb, 'PENDING', ${createdBy})
    ON CONFLICT (product_id) WHERE (status = 'PENDING')
    DO UPDATE SET
      payload    = EXCLUDED.payload,
      created_at = NOW(),
      created_by = EXCLUDED.created_by
  `
}

export async function PUT(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  // Verificar que el producto existe
  const product = await prisma.products.findUnique({
    where:  { id },
    select: { id: true, official_name: true },
  })
  if (!product) return NextResponse.json({ error: 'Artículo no encontrado.' }, { status: 404 })

  const {
    official_name, base_unit, condition, sub_condition, codigo_tango, conversion_factor,
    is_for_branches, is_produced_in_kitchen, is_produced_in_fabrica,
    is_produced_in_armado, is_fractionable, is_active,
  } = body

  // Validar solo los campos enviados
  if (official_name !== undefined) {
    if (!official_name.trim()) return NextResponse.json({ error: 'El nombre no puede estar vacío.' }, { status: 400 })
    const conflict = await prisma.$queryRaw`
      SELECT id FROM core.products
      WHERE UPPER(TRIM(official_name)) = UPPER(TRIM(${official_name.trim()}))
        AND id != ${id}::uuid
      LIMIT 1
    `
    if (conflict.length > 0) {
      return NextResponse.json({ error: 'Ya existe un artículo con ese nombre.' }, { status: 409 })
    }
  }
  if (base_unit !== undefined && !VALID_UNITS.includes(base_unit)) {
    return NextResponse.json({ error: `Unidad inválida. Válidas: ${VALID_UNITS.join(', ')}` }, { status: 400 })
  }
  if (conversion_factor !== undefined && conversion_factor !== '' && conversion_factor != null) {
    const n = Number(conversion_factor)
    if (isNaN(n) || n <= 0) {
      return NextResponse.json({ error: 'Factor de conversión debe ser un número mayor a 0.' }, { status: 400 })
    }
  }

  // Construir payload solo con campos presentes en el body
  const payload = {}
  if (official_name !== undefined) payload.official_name = official_name.trim()
  if (base_unit      !== undefined) payload.base_unit     = base_unit
  if (condition      !== undefined) payload.condition     = condition     || null
  if (sub_condition  !== undefined) payload.sub_condition = sub_condition || null
  if (codigo_tango   !== undefined) {
    payload.codigo_tango = (codigo_tango !== '' && codigo_tango != null) ? Number(codigo_tango) : null
  }
  if (conversion_factor !== undefined) {
    payload.conversion_factor = (conversion_factor !== '' && conversion_factor != null) ? Number(conversion_factor) : null
  }
  if (is_for_branches        !== undefined) payload.is_for_branches        = Boolean(is_for_branches)
  if (is_produced_in_kitchen !== undefined) payload.is_produced_in_kitchen = Boolean(is_produced_in_kitchen)
  if (is_produced_in_fabrica !== undefined) payload.is_produced_in_fabrica = Boolean(is_produced_in_fabrica)
  if (is_produced_in_armado  !== undefined) payload.is_produced_in_armado  = Boolean(is_produced_in_armado)
  if (is_fractionable        !== undefined) payload.is_fractionable        = Boolean(is_fractionable)
  if (is_active              !== undefined) payload.is_active              = Boolean(is_active)

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: 'No se enviaron campos a modificar.' }, { status: 400 })
  }

  try {
    await upsertPending(id, payload, session.user?.name || session.user?.sector || 'admin')
    return NextResponse.json({ ok: true, message: 'Cambio encolado como pendiente.' })
  } catch (err) {
    console.error('[PUT /api/admin/articulos/[id]]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params

  const product = await prisma.products.findUnique({
    where:  { id },
    select: { id: true, official_name: true, is_active: true },
  })
  if (!product) return NextResponse.json({ error: 'Artículo no encontrado.' }, { status: 404 })

  // Soft-delete va como pending (NO borrado físico — hay FK con supply_rules / stock / order_items)
  try {
    await upsertPending(id, { is_active: false }, session.user?.name || session.user?.sector || 'admin')
    return NextResponse.json({ ok: true, message: 'Desactivación encolada como pendiente.' })
  } catch (err) {
    console.error('[DELETE /api/admin/articulos/[id]]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
