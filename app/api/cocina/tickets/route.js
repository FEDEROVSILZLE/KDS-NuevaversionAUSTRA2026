// app/api/cocina/tickets/route.js
// Tickets de producción de Cocina (inicio / pausa / fin) sobre las funciones
// de sql/tickets_produccion.sql. Un ticket por order_item.
//
// GET  -> tickets abiertos de COCINA con semáforo, indexados por order_item_id
// POST -> { action: 'start' | 'pause' | 'resume' | 'finish', item_id, produced_quantity? }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

const SECTOR = 'COCINA'

async function auth() {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== SECTOR) return null
  return session
}

// Ticket abierto (PENDING / IN_PROGRESS / PAUSED) de COCINA que contiene este order_item
async function ticketAbierto(tx, itemId) {
  const rows = await tx.$queryRaw`
    SELECT t.id::text AS id, t.status::text AS status
      FROM operations.production_tickets t
      JOIN operations.production_ticket_items ti ON ti.ticket_id = t.id
      JOIN core.sectors s ON s.id = t.sector_id
     WHERE ti.order_item_id = ${itemId}::uuid
       AND s.code = ${SECTOR}
       AND t.status IN ('PENDING','IN_PROGRESS','PAUSED')
     LIMIT 1`
  return rows[0] ?? null
}

async function crearEIniciar(tx, itemId, user, clientTs) {
  const items = JSON.stringify([{ order_item_id: itemId }])
  const [{ id }] = await tx.$queryRaw`
    SELECT operations.ticket_create(${SECTOR}, ${items}::jsonb, ${user})::text AS id`
  await tx.$queryRaw`SELECT 1 FROM operations.ticket_start(${id}::uuid, ${user}, ${clientTs}::timestamptz)`
  return id
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const rows = await prisma.$queryRaw`
      SELECT ti.order_item_id::text  AS item_id,
             h.id::text              AS ticket_id,
             h.status::text          AS status,
             h.started_at,
             h.elapsed_net_s::float8 AS elapsed_s,
             h.expected_s::float8    AS expected_s,
             h.ratio::float8         AS ratio,
             h.alerta
        FROM operations.v_open_tickets_health h
        JOIN operations.production_ticket_items ti ON ti.ticket_id = h.id
       WHERE h.sector_code = ${SECTOR}
         AND ti.order_item_id IS NOT NULL`

    const tickets = {}
    for (const r of rows) tickets[r.item_id] = r
    return NextResponse.json({ tickets, server_time: new Date().toISOString() })
  } catch (error) {
    console.error('Error GET /api/cocina/tickets:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const user = session.user.name || SECTOR

  try {
    const { action, item_id, produced_quantity, client_ts } = await request.json()
    // reloj del dispositivo: solo auditoría, las métricas usan la hora del server
    const clientTs = client_ts && !Number.isNaN(Date.parse(client_ts)) ? new Date(client_ts) : null
    if (!item_id || !['start', 'pause', 'resume', 'finish'].includes(action)) {
      return NextResponse.json({ error: 'action e item_id requeridos' }, { status: 400 })
    }
    if (action === 'finish' && (produced_quantity === undefined || produced_quantity === '' || Number(produced_quantity) < 0)) {
      return NextResponse.json({ error: 'produced_quantity requerido' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const abierto = await ticketAbierto(tx, item_id)

      if (action === 'start') {
        if (abierto) return { ticket_id: abierto.id, already: true }
        return { ticket_id: await crearEIniciar(tx, item_id, user, clientTs) }
      }

      if (action === 'pause' || action === 'resume') {
        if (!abierto) throw new Error('No hay ticket abierto para este ítem')
        if (action === 'pause') {
          await tx.$executeRaw`SELECT operations.ticket_pause(${abierto.id}::uuid, ${user}, NULL)`
        } else {
          await tx.$executeRaw`SELECT operations.ticket_resume(${abierto.id}::uuid, ${user})`
        }
        return { ticket_id: abierto.id }
      }

      // finish: si nunca tocaron "Iniciar", se crea y cierra en el acto.
      // El trigger de calidad lo marca SUSPECT (demasiado rápido) y no ensucia las métricas.
      let ticketId = abierto?.id
      if (!ticketId) ticketId = await crearEIniciar(tx, item_id, user, clientTs)

      const qty = JSON.stringify([{ item_id, qty: Number(produced_quantity) }])
      await tx.$queryRaw`
        SELECT 1 FROM operations.ticket_finish(${ticketId}::uuid, ${user}, ${qty}::jsonb, ${clientTs}::timestamptz)`
      return { ticket_id: ticketId, sin_inicio: !abierto }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Error POST /api/cocina/tickets:', error)
    // los RAISE de Postgres traen un mensaje legible (ej: "Ticket ... no está IN_PROGRESS")
    const raw = error?.meta?.message || error.message || 'Error'
    const msg = raw.replace(/^[\s\S]*?ERROR:\s*/, '').split('\n')[0].replace(/`$/, '')
    return NextResponse.json({ error: msg }, { status: 409 })
  }
}
