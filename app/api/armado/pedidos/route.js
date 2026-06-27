// app/api/armado/pedidos/route.js
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

// Mapeo de sub_condition a etiqueta legible y tipo de tapa
const TIPOS = {
  horno:        { label: 'Horno',        esTapa: true,  tapaNombre: 'Horno' },
  freir:        { label: 'Para Freír',   esTapa: true,  tapaNombre: 'Freír' },
  semillas:     { label: 'Semillas',     esTapa: true,  tapaNombre: 'Semillas' },
  hojaldre:     { label: 'Hojaldre',     esTapa: false, tapaNombre: null },
  copetin:      { label: 'Copetín',      esTapa: false, tapaNombre: null },
  fraccionados: { label: 'Fraccionados', esTapa: false, tapaNombre: null },
  sandwiches:   { label: 'Sandwiches',   esTapa: false, tapaNombre: null },
}

const ORDEN_TIPOS = ['horno', 'freir', 'semillas', 'hojaldre', 'copetin', 'fraccionados', 'sandwiches']

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'ARMADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha')

  try {
    const sectorArmado = await prisma.sectors.findUnique({
      where: { code: 'ARMADO' },
    })

    // Usar fecha recibida o mañana por defecto
    const fechaFiltro = fecha
      ? new Date(fecha + 'T23:59:59')
      : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(23,59,59); return d })()

    const items = await prisma.branch_order_items.findMany({
      where: {
        assigned_sector_id: sectorArmado.id,
        item_status: { in: ['PENDING_CONFIRMATION', 'IN_PRODUCTION'] },
        branch_orders: {
          is_active: true,
          // ★ lte: muestra pedidos pendientes de esa fecha y días anteriores
          requested_delivery_date: { lte: fechaFiltro },
        },
      },
      include: {
        products: {
          select: {
            id: true,
            official_name: true,
            base_unit: true,
            sub_condition: true,
            condition: true,
          },
        },
        branch_orders: {
          select: {
            id: true,
            order_number: true,
            branch_code: true,
            branch_name: true,
            requested_delivery_date: true,
            priority: true,
          },
        },
      },
      orderBy: [
        { branch_orders: { priority: 'asc' } },
        { branch_orders: { requested_delivery_date: 'asc' } },
        { branch_orders: { branch_code: 'asc' } },
      ],
    })

    // ── Estructurar por sucursal ──────────────────────────────────────────
    const porSucursal = {}
    items.forEach(item => {
      const branch  = item.branch_orders.branch_code
      const subCond = item.products.sub_condition?.toLowerCase() || 'otros'

      if (!porSucursal[branch]) {
        porSucursal[branch] = {
          branch_code:   branch,
          branch_name:   item.branch_orders.branch_name || branch,
          delivery_date: item.branch_orders.requested_delivery_date,
          items: [],
        }
      }
      porSucursal[branch].items.push({
        id:                 item.id,
        product_id:         item.product_id,
        product_name:       item.products.official_name,
        sub_condition:      subCond,
        requested_quantity: Number(item.requested_quantity),
        confirmed_quantity: item.confirmed_quantity ? Number(item.confirmed_quantity) : null,
        unit:               item.unit,
        item_status:        item.item_status,
        es_empanada:        ['horno','freir','semillas'].includes(subCond),
      })
    })

    // ── Estructurar total agrupado por sub_condition ──────────────────────
    const totalPorTipo = {}
    items.forEach(item => {
      const subCond = item.products.sub_condition?.toLowerCase() || 'otros'
      if (!totalPorTipo[subCond]) totalPorTipo[subCond] = []

      const existing = totalPorTipo[subCond].find(p => p.product_id === item.product_id)
      if (existing) {
        existing.total_requested += Number(item.requested_quantity)
        if (item.confirmed_quantity) existing.total_confirmed += Number(item.confirmed_quantity)
      } else {
        totalPorTipo[subCond].push({
          product_id:      item.product_id,
          product_name:    item.products.official_name,
          sub_condition:   subCond,
          unit:            item.unit,
          total_requested: Number(item.requested_quantity),
          total_confirmed: item.confirmed_quantity ? Number(item.confirmed_quantity) : 0,
        })
      }
    })

    Object.keys(totalPorTipo).forEach(tipo => {
      totalPorTipo[tipo].sort((a, b) => a.product_name.localeCompare(b.product_name))
    })

    // ── Resumen de tapas ──────────────────────────────────────────────────
    const resumenTapas = Object.entries(TIPOS)
      .filter(([, v]) => v.esTapa)
      .map(([key, v]) => ({
        tipo:  v.tapaNombre,
        total: (totalPorTipo[key] || []).reduce((s, p) => s + p.total_requested, 0),
      }))
      .filter(t => t.total > 0)

    const totalOrdenado = ORDEN_TIPOS
      .filter(tipo => totalPorTipo[tipo]?.length)
      .map(tipo => ({
        tipo,
        label:     TIPOS[tipo]?.label || tipo,
        esTapa:    TIPOS[tipo]?.esTapa || false,
        subtotal:  (totalPorTipo[tipo] || []).reduce((s, p) => s + p.total_requested, 0),
        productos: totalPorTipo[tipo] || [],
      }))

    return NextResponse.json({
      por_sucursal:   Object.values(porSucursal),
      total_por_tipo: totalOrdenado,
      resumen_tapas:  resumenTapas,
    })

  } catch (error) {
    console.error('Error cargando pedidos de Armado:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'ARMADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    const { confirmaciones } = await request.json()

    if (!confirmaciones?.length) {
      return NextResponse.json({ error: 'Sin confirmaciones' }, { status: 400 })
    }

    await prisma.$transaction(
      confirmaciones
        .filter(c => c.listo)
        .map(c =>
          prisma.branch_order_items.update({
            where: { id: c.item_id },
            data: {
              confirmed_quantity: c.confirmed_quantity,
              item_status:        'READY_FOR_PICKUP',
              confirmed_by:       session.user.name || 'ARMADO',
              confirmed_at:       new Date(),
            },
          })
        )
    )

    return NextResponse.json({ ok: true, confirmados: confirmaciones.filter(c => c.listo).length })

  } catch (error) {
    console.error('Error confirmando items:', error)
    return NextResponse.json({ error: 'Error al confirmar' }, { status: 500 })
  }
}
