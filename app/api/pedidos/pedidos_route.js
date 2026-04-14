// app/api/pedidos/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ─── GET: últimos pedidos de hoy para una sucursal ───────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sucursal = searchParams.get('sucursal')
  if (!sucursal) return NextResponse.json([], { status: 200 })

  try {
    // Inicio del día en Argentina (UTC-3)
    const ahora = new Date()
    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    // Ajuste zona: traemos pedidos de las últimas 24h como fallback simple
    inicioDia.setTime(inicioDia.getTime() - 3 * 60 * 60 * 1000)

    const pedidos = await prisma.branch_orders.findMany({
      where: {
        branch_code: sucursal,
        is_active: true,
        created_at: { gte: inicioDia },
        status: { not: 'CANCELLED' },
      },
      include: {
        branch_order_items: {
          include: {
            products: {
              select: { official_name: true, base_unit: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    // Agrupar items sumando cantidades por producto
    const mapa = new Map()
    pedidos.forEach(p => {
      p.branch_order_items.forEach(item => {
        const key = item.product_id
        const nombre = item.products?.official_name || '—'
        const unidad = item.products?.base_unit || ''
        if (mapa.has(key)) {
          mapa.get(key).cantidad += Number(item.requested_quantity)
        } else {
          mapa.set(key, { nombre, cantidad: Number(item.requested_quantity), unidad })
        }
      })
    })

    const resultado = Array.from(mapa.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre))

    return NextResponse.json(resultado)
  } catch (err) {
    console.error('GET /api/pedidos:', err)
    return NextResponse.json({ error: 'Error al cargar pedidos' }, { status: 500 })
  }
}

// ─── POST: crear pedido o retiro ─────────────────────────────────────────────
export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const body = await request.json()
    const { tipo, sucursal, items } = body

    if (!sucursal || !items || items.length === 0) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    // Obtener sector de la sucursal
    const sector = await prisma.sectors.findFirst({
      where: { code: sucursal, is_active: true },
    })
    if (!sector) return NextResponse.json({ error: 'Sucursal no encontrada' }, { status: 404 })

    // Crear el pedido con sus items en una transacción
    const pedido = await prisma.$transaction(async (tx) => {
      // Cabecera
      const nuevoPedido = await tx.branch_orders.create({
        data: {
          branch_code: sucursal,
          branch_name: sector.name,
          status: 'PENDING_CONFIRMATION',
          notes: tipo === 'RETIRO' ? 'RETIRO DE MERCADERÍA' : null,
          created_by: session.user?.sector || sucursal,
        },
      })

      // Items — el trigger de la DB asigna assigned_sector_id automáticamente
      // pero si no está activo el trigger, lo asignamos acá como fallback
      for (const item of items) {
        // Buscar el sector proveedor desde supply_rules
        const regla = await tx.supply_rules.findFirst({
          where: {
            product_id: item.product_id,
            is_default: true,
            is_active: true,
          },
          select: { supplier_sector_id: true },
        })

        await tx.branch_order_items.create({
          data: {
            branch_order_id: nuevoPedido.id,
            product_id: item.product_id,
            requested_quantity: item.cantidad,
            unit: item.unidad,
            assigned_sector_id: regla?.supplier_sector_id ?? null,
            item_status: 'PENDING_CONFIRMATION',
            item_notes: item.condicion || null,
          },
        })
      }

      return nuevoPedido
    })

    return NextResponse.json({
      ok: true,
      order_number: pedido.order_number,
      id: pedido.id,
    })

  } catch (err) {
    console.error('POST /api/pedidos:', err)
    return NextResponse.json({ error: err.message || 'Error al crear pedido' }, { status: 500 })
  }
}
