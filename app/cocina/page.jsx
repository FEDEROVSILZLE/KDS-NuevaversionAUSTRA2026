'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

// ── Tickets de producción ────────────────────────────────────────────────────
function formatDuracion(seg) {
  const t = Math.max(0, Math.floor(seg))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

const COLOR_ALERTA = {
  OK:          '#7dd3fc',
  ATENCION:    '#f59e0b',
  CRITICO:     '#ef4444',
  PAUSA_LARGA: '#ef4444',
}

function fechaHoy() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date())
}

export default function CocinaPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [ordenes, setOrdenes]           = useState({ emp: [], fracc: [] })
  const [loading, setLoading]           = useState(true)
  const [cantidades, setCantidades]     = useState({})
  const [confirmados, setConfirmados]   = useState({})
  const [confirmando, setConfirmando]   = useState({})
  const [recetaActiva, setRecetaActiva] = useState(null)
  const [loadingReceta, setLoadingReceta] = useState(false)
  const [toast, setToast]               = useState(null)

  // ── Tickets (inicio/fin de producción) ─────────────────────────────────────
  const [tickets, setTickets]           = useState({})   // { [order_item_id]: ticket }
  const [ticketsAt, setTicketsAt]       = useState(0)    // ms locales del último fetch
  const [ahora, setAhora]               = useState(0)
  const [accionando, setAccionando]     = useState({})

  // ── Stock modal ────────────────────────────────────────────────────────────
  const [stockModal, setStockModal]     = useState(false)
  const [stockData, setStockData]       = useState([])
  const [loadingStock, setLoadingStock] = useState(false)
  const [stockFiltro, setStockFiltro]   = useState('')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargarOrdenes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cocina/ordenes')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setOrdenes(data)

      const init = {}
      ;[...data.emp, ...data.fracc].forEach(item => {
        init[item.id] = item.produced_quantity ?? item.requested_quantity
      })
      setCantidades(init)

      const conf = {}
      ;[...data.emp, ...data.fracc].forEach(item => {
        if (item.item_status === 'READY_FOR_PICKUP') conf[item.id] = true
      })
      setConfirmados(conf)

    } catch {
      mostrarToast('Error al cargar órdenes', 'err')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') cargarOrdenes()
  }, [status, cargarOrdenes])

  // ── Tickets: carga + refresco cada 30 s (no pisa las cantidades tipeadas) ──
  const cargarTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/cocina/tickets')
      if (!res.ok) return
      const data = await res.json()
      setTickets(data.tickets || {})
      setTicketsAt(Date.now())
    } catch { /* se reintenta en el próximo ciclo */ }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    const first = setTimeout(cargarTickets, 0)
    const poll  = setInterval(cargarTickets, 30000)
    const tick  = setInterval(() => setAhora(Date.now()), 1000)
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(tick) }
  }, [status, cargarTickets])

  // Segundos netos del ticket: lo que dijo el server + lo que pasó desde el fetch.
  // No depende del reloj de la PC (solo de la diferencia local).
  const segundosTicket = (t) => {
    if (!t) return 0
    if (t.status !== 'IN_PROGRESS') return t.elapsed_s ?? 0
    return (t.elapsed_s ?? 0) + Math.max(0, (ahora - ticketsAt) / 1000)
  }

  const accionTicket = async (item, action) => {
    setAccionando(prev => ({ ...prev, [item.id]: true }))
    try {
      const res = await fetch('/api/cocina/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, item_id: item.id, client_ts: new Date().toISOString() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error')
      if (action === 'start')  mostrarToast(`▶ ${item.product_name} en producción`)
      if (action === 'pause')  mostrarToast(`${item.product_name} pausado`)
      if (action === 'resume') mostrarToast(`▶ ${item.product_name} reanudado`)
    } catch (e) {
      mostrarToast(e.message || 'Error en el ticket', 'err')
    } finally {
      setAccionando(prev => ({ ...prev, [item.id]: false }))
      cargarTickets()
    }
  }

  // ── Abrir modal de stock ───────────────────────────────────────────────────
  const abrirStock = async () => {
    setStockModal(true)
    setStockFiltro('')
    setLoadingStock(true)
    try {
      const res = await fetch('/api/cocina/stock')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setStockData(data)
    } catch {
      mostrarToast('Error al cargar stock', 'err')
    } finally {
      setLoadingStock(false)
    }
  }

  // ── Ver receta de un item ──────────────────────────────────────────────────
  const verReceta = async (item) => {
    if (recetaActiva?.item.id === item.id) {
      setRecetaActiva(null)
      return
    }
    setLoadingReceta(true)
    setRecetaActiva({ item, ingredientes: null })
    try {
      const qty = cantidades[item.id] ?? item.requested_quantity
      const res = await fetch(
        `/api/cocina/receta?product_id=${item.product_id}&quantity=${qty}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRecetaActiva({ item, ...data })
    } catch {
      mostrarToast('Error al cargar receta', 'err')
      setRecetaActiva(null)
    } finally {
      setLoadingReceta(false)
    }
  }

  // ── Confirmar producción ───────────────────────────────────────────────────
  const confirmar = async (item) => {
    const cantidad = cantidades[item.id]
    if (cantidad === undefined || cantidad === '') {
      mostrarToast('Ingresá la cantidad producida', 'err')
      return
    }
    if (!confirm(`¿Confirmar ${cantidad} ${item.unit} de ${item.product_name}?`)) return

    setConfirmando(prev => ({ ...prev, [item.id]: true }))
    try {
      // Finaliza el ticket y confirma el ítem en una sola transacción.
      // Si nunca tocaron ▶, el server crea el ticket y lo cierra en el acto (no cuenta para tiempos).
      const res = await fetch('/api/cocina/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finish',
          item_id: item.id,
          produced_quantity: Number(cantidad),
          client_ts: new Date().toISOString(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error al confirmar')
      setConfirmados(prev => ({ ...prev, [item.id]: true }))
      mostrarToast(data.sin_inicio
        ? `${item.product_name} confirmado ✓ (sin ▶ inicio: no suma a tiempos)`
        : `${item.product_name} confirmado ✓`)
      if (recetaActiva?.item.id === item.id) setRecetaActiva(null)
    } catch (e) {
      mostrarToast(e.message || 'Error al confirmar', 'err')
    } finally {
      setConfirmando(prev => ({ ...prev, [item.id]: false }))
      cargarTickets()
    }
  }

  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  // Filtro de stock por nombre o categoría
  const stockFiltrado = stockData.filter(item =>
    item.nombre.toLowerCase().includes(stockFiltro.toLowerCase()) ||
    item.condition.toLowerCase().includes(stockFiltro.toLowerCase())
  )

  return (
    <div style={s.page}>

      {/* TOAST */}
      {toast && (
        <div style={{ ...s.toast, background: toast.tipo === 'err' ? '#7f1d1d' : '#14532d', borderColor: toast.tipo === 'err' ? '#ef4444' : '#22c55e' }}>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <header style={s.header}>
        <div>
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoCyan}> COCINA</span>
        </div>
        <span style={s.fecha}>{fechaHoy()}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.name}</span>
          <button style={s.btnStock} onClick={abrirStock}>📦 Stock</button>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>
          Cargando órdenes...
        </div>
      ) : (
        <main style={s.main}>

          {/* ── AVISO DE TICKETS DEMORADOS ── */}
          {(() => {
            const demorados = Object.values(tickets).filter(t => t.alerta === 'CRITICO' || t.alerta === 'PAUSA_LARGA')
            if (demorados.length === 0) return null
            return (
              <div style={s.bannerDemora}>
                ⚠ {demorados.length} ticket{demorados.length !== 1 ? 's' : ''} demorado{demorados.length !== 1 ? 's' : ''}.
                ¿Siguen en curso? Si ya terminaron, confirmalos con ✓; si están frenados, tocá Pausa.
              </div>
            )
          })()}

          {/* ── DOS COLUMNAS: EMP y FRACC ── */}
          <div style={s.cols}>
            <Columna
              titulo="RELL. EMP."
              color="#92400e"
              items={ordenes.emp}
              cantidades={cantidades}
              confirmados={confirmados}
              confirmando={confirmando}
              recetaActiva={recetaActiva}
              onCantidad={(id, val) => setCantidades(prev => ({ ...prev, [id]: val }))}
              onVerReceta={verReceta}
              onConfirmar={confirmar}
              tickets={tickets}
              segundosTicket={segundosTicket}
              accionando={accionando}
              onTicket={accionTicket}
            />
            <Columna
              titulo="FRACC."
              color="#1e40af"
              items={ordenes.fracc}
              cantidades={cantidades}
              confirmados={confirmados}
              confirmando={confirmando}
              recetaActiva={recetaActiva}
              onCantidad={(id, val) => setCantidades(prev => ({ ...prev, [id]: val }))}
              onVerReceta={verReceta}
              onConfirmar={confirmar}
              tickets={tickets}
              segundosTicket={segundosTicket}
              accionando={accionando}
              onTicket={accionTicket}
            />
          </div>

          {/* ── PANEL DE INSUMOS (receta seleccionada) ── */}
          {recetaActiva && (
            <div style={s.insumosPanel}>
              <div style={s.insumosTitulo}>
                <span>Insumos — <strong>{recetaActiva.item.product_name}</strong></span>
                <span style={{ color: '#8899aa', fontSize: '12px' }}>
                  para {cantidades[recetaActiva.item.id] ?? recetaActiva.item.requested_quantity} {recetaActiva.item.unit}
                </span>
                <button style={s.btnCerrarReceta} onClick={() => setRecetaActiva(null)}>✕</button>
              </div>

              {loadingReceta ? (
                <p style={{ color: '#8899aa', padding: '1rem' }}>Calculando...</p>
              ) : recetaActiva.sinReceta ? (
                <p style={{ color: '#8899aa', padding: '1rem' }}>Sin receta cargada para este producto</p>
              ) : (
                <table style={s.tabla}>
                  <thead>
                    <tr>
                      <th style={s.th}>Ingrediente</th>
                      <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Cantidad</th>
                      <th style={{ ...s.th, width: '80px' }}>Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recetaActiva.ingredientes?.map((ing, i) => (
                      <tr key={i}>
                        <td style={{ ...s.td, ...(ing.opcional ? { color: '#8899aa', fontStyle: 'italic' } : {}) }}>
                          {ing.nombre}
                          {ing.opcional && <span style={{ fontSize: '10px', marginLeft: '6px', color: '#6b7280' }}>(opcional)</span>}
                        </td>
                        <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#fbbf24' }}>
                          {ing.cantidad}
                        </td>
                        <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{ing.unidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Botón recargar */}
          <div style={{ textAlign: 'center', padding: '1rem 0 2rem' }}>
            <button style={s.btnRecargar} onClick={cargarOrdenes}>
              ↻ Recargar órdenes
            </button>
          </div>

        </main>
      )}

      {/* ── MODAL STOCK ─────────────────────────────────────────────────────── */}
      {stockModal && (
        <div style={m.overlay} onClick={() => setStockModal(false)}>
          <div style={m.modal} onClick={e => e.stopPropagation()}>

            {/* Header del modal */}
            <div style={m.header}>
              <span style={m.titulo}>📦 Stock Cocina</span>
              <span style={{ color: '#8899aa', fontSize: '12px' }}>
                {stockFiltrado.length} productos
              </span>
              <input
                style={m.buscador}
                type="text"
                placeholder="Buscar..."
                value={stockFiltro}
                onChange={e => setStockFiltro(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
              <button style={m.btnCerrar} onClick={() => setStockModal(false)}>✕</button>
            </div>

            {/* Contenido */}
            {loadingStock ? (
              <p style={{ color: '#8899aa', padding: '2rem', textAlign: 'center' }}>
                Cargando stock...
              </p>
            ) : stockData.length === 0 ? (
              <p style={{ color: '#8899aa', padding: '2rem', textAlign: 'center' }}>
                Sin datos de stock registrados
              </p>
            ) : (
              <div style={m.body}>
                <table style={m.tabla}>
                  <thead>
                    <tr>
                      <th style={m.th}>Producto</th>
                      <th style={m.th}>Categoría</th>
                      <th style={{ ...m.th, textAlign: 'center', width: '100px' }}>Cantidad</th>
                      <th style={{ ...m.th, width: '70px' }}>Unidad</th>
                      <th style={{ ...m.th, width: '130px' }}>Actualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockFiltrado.map((item, i) => (
                      <tr key={item.product_id} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1a2a' }}>
                        <td style={m.td}>{item.nombre}</td>
                        <td style={{ ...m.td, color: '#8899aa', fontSize: '12px' }}>
                          {item.condition}
                        </td>
                        <td style={{
                          ...m.td,
                          textAlign: 'center',
                          fontWeight: '700',
                          color: item.cantidad === 0
                            ? '#ef4444'
                            : item.cantidad < 5
                              ? '#f59e0b'
                              : '#22c55e',
                        }}>
                          {item.cantidad}
                        </td>
                        <td style={{ ...m.td, color: '#8899aa', fontSize: '12px' }}>{item.unidad}</td>
                        <td style={{ ...m.td, color: '#6b7280', fontSize: '11px' }}>
                          {item.actualizado
                            ? new Date(item.actualizado).toLocaleString('es-AR', {
                                timeZone: 'America/Argentina/Buenos_Aires',
                                day: '2-digit', month: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  )
}

// ─── Componente columna ───────────────────────────────────────────────────────
function Columna({ titulo, color, items, cantidades, confirmados, confirmando, recetaActiva, onCantidad, onVerReceta, onConfirmar, tickets, segundosTicket, accionando, onTicket }) {
  const pendientes   = items.filter(i => !confirmados[i.id])
  const confirmadosL = items.filter(i => confirmados[i.id])

  return (
    <div style={col.wrapper}>
      <div style={{ ...col.header, borderColor: color }}>
        <span style={{ ...col.titulo, color }}>PEDIDO — {titulo}</span>
        <span style={col.badge}>
          {pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <p style={{ color: '#8899aa', padding: '1rem', fontSize: '13px', textAlign: 'center' }}>
          Sin órdenes pendientes
        </p>
      ) : (
        <table style={col.tabla}>
          <thead>
            <tr>
              <th style={col.th}>Descripción</th>
              <th style={{ ...col.th, width: '110px', textAlign: 'center' }}>Cant. pedida</th>
              <th style={{ ...col.th, width: '110px', textAlign: 'center' }}>Producir</th>
              <th style={{ ...col.th, width: '120px', textAlign: 'center' }}>Tiempo</th>
              <th style={{ ...col.th, width: '40px' }}></th>
              <th style={{ ...col.th, width: '80px', textAlign: 'center' }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map(item => (
              <FilaProduccion
                key={item.id}
                item={item}
                cantidad={cantidades[item.id] ?? item.requested_quantity}
                confirmado={false}
                confirmando={confirmando[item.id]}
                esActiva={recetaActiva?.item.id === item.id}
                onCantidad={onCantidad}
                onVerReceta={onVerReceta}
                onConfirmar={onConfirmar}
                ticket={tickets[item.id]}
                segundos={segundosTicket(tickets[item.id])}
                accionando={accionando[item.id]}
                onTicket={onTicket}
              />
            ))}
            {confirmadosL.map(item => (
              <FilaProduccion
                key={item.id}
                item={item}
                cantidad={cantidades[item.id] ?? item.produced_quantity ?? item.requested_quantity}
                confirmado={true}
                confirmando={false}
                esActiva={false}
                onCantidad={onCantidad}
                onVerReceta={onVerReceta}
                onConfirmar={onConfirmar}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Fila de producción ───────────────────────────────────────────────────────
function FilaProduccion({ item, cantidad, confirmado, confirmando, esActiva, onCantidad, onVerReceta, onConfirmar, ticket, segundos, accionando, onTicket }) {
  const alerta  = ticket?.alerta || 'OK'
  const enRojo  = !confirmado && (alerta === 'CRITICO' || alerta === 'PAUSA_LARGA')
  const pausado = ticket?.status === 'PAUSED'
  return (
    <tr
      style={{
        background: confirmado ? '#0d2518' : enRojo ? '#2a1414' : esActiva ? '#1a2f1a' : 'transparent',
        opacity: confirmado ? 0.6 : 1,
        cursor: 'pointer',
      }}
      onClick={() => !confirmado && onVerReceta(item)}
    >
      <td style={{ ...col.td, textDecoration: confirmado ? 'line-through' : 'none', color: confirmado ? '#6b7280' : '#c8d8e8' }}>
        {item.product_name}
        {item.origen_sector && (
          <span style={{ fontSize: '10px', color: '#4a7fa5', marginLeft: '6px' }}>
            [{item.origen_sector}]
          </span>
        )}
      </td>
      <td style={{ ...col.td, textAlign: 'center', color: '#7dd3fc', fontWeight: '600' }}>
        {item.requested_quantity} {item.unit}
      </td>
      <td style={{ ...col.td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <input
          type="number"
          min="0"
          step="0.5"
          value={cantidad}
          disabled={confirmado}
          onChange={e => onCantidad(item.id, e.target.value)}
          onClick={e => e.target.select()}
          style={{
            ...col.input,
            opacity: confirmado ? 0.5 : 1,
            cursor:  confirmado ? 'not-allowed' : 'text',
            borderColor: Number(cantidad) !== item.requested_quantity ? '#f59e0b' : '#243550',
          }}
        />
      </td>
      <td style={{ ...col.td, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
        {!confirmado && (
          !ticket ? (
            <button
              style={{ ...col.btnTicket, color: '#22c55e', borderColor: '#14532d' }}
              disabled={accionando}
              onClick={() => onTicket(item, 'start')}
              title="Iniciar producción"
            >
              {accionando ? '...' : '▶ Iniciar'}
            </button>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{ fontVariantNumeric: 'tabular-nums', fontWeight: '700', color: pausado ? '#6b7280' : COLOR_ALERTA[alerta] }}
                title={ticket.expected_s ? `Esperado: ${formatDuracion(ticket.expected_s)}` : undefined}
              >
                {formatDuracion(segundos)}
              </span>
              <button
                style={col.btnTicket}
                disabled={accionando}
                onClick={() => onTicket(item, pausado ? 'resume' : 'pause')}
                title={pausado ? 'Reanudar' : 'Pausar'}
              >
                {accionando ? '…' : pausado ? '▶ Seguir' : 'Pausa'}
              </button>
            </span>
          )
        )}
      </td>
      <td style={{ ...col.td, textAlign: 'center' }} onClick={e => { e.stopPropagation(); !confirmado && onVerReceta(item) }}>
        <span style={{ fontSize: '14px', cursor: confirmado ? 'default' : 'pointer' }}>
          {confirmado ? '' : '📖'}
        </span>
      </td>
      <td style={{ ...col.td, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <button
          style={{
            ...col.btnCheck,
            background:  confirmado ? '#0d2518' : '#162236',
            borderColor: confirmado ? '#22c55e' : '#243550',
            color:       confirmado ? '#22c55e' : '#7a9bb8',
            cursor:      confirmado || confirmando ? 'not-allowed' : 'pointer',
          }}
          disabled={confirmado || confirmando}
          onClick={() => !confirmado && onConfirmar(item)}
        >
          {confirmando ? '...' : '✓'}
        </button>
      </td>
    </tr>
  )
}

// ─── Estilos columna ──────────────────────────────────────────────────────────
const col = {
  wrapper:  { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#0f1c2e', borderBottom: '2px solid', borderLeft: '4px solid' },
  titulo:   { fontWeight: '700', fontSize: '13px', letterSpacing: '.08em' },
  badge:    { background: '#1e3050', color: '#7a9bb8', fontSize: '11px', padding: '2px 8px', borderRadius: '10px' },
  tabla:    { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:       { background: '#0f1c2e', color: '#4a7fa5', padding: '6px 10px', textAlign: 'left', fontSize: '10px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550' },
  td:       { color: '#c8d8e8', padding: '8px 10px', borderBottom: '1px solid #1a2a3a' },
  input:    { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '80px', textAlign: 'center', outline: 'none' },
  btnCheck: { border: '1px solid', borderRadius: '6px', fontSize: '14px', fontWeight: '700', padding: '4px 10px', width: '40px' },
  btnTicket:{ background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '12px', fontWeight: '700', padding: '3px 8px', cursor: 'pointer' },
}

// ─── Estilos página ───────────────────────────────────────────────────────────
const s = {
  page:      { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0, gap: '16px' },
  logoBlanco:{ color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:  { color: '#ef4444', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  fecha:     { color: '#8899aa', fontSize: '13px', flex: 1, textAlign: 'center' },
  userLabel: { color: '#8899aa', fontSize: '13px' },
  btnSalir:  { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnStock:  { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#7dd3fc', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  main:      { flex: 1, padding: '1.5rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto' },
  cols:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' },
  bannerDemora: { background: '#2a1414', border: '1px solid #ef4444', borderRadius: '8px', color: '#fca5a5', fontSize: '13px', fontWeight: '600', padding: '10px 16px', marginBottom: '16px' },

  insumosPanel:    { background: '#162236', border: '1px solid #F4C430', borderRadius: '10px', overflow: 'hidden', marginBottom: '20px' },
  insumosTitulo:   { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550' },
  btnCerrarReceta: { marginLeft: 'auto', background: 'none', border: 'none', color: '#8899aa', fontSize: '16px', cursor: 'pointer' },

  tabla:      { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:         { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550' },
  td:         { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  btnRecargar:{ background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '8px 20px', cursor: 'pointer' },
  toast:      { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}

// ─── Estilos modal ────────────────────────────────────────────────────────────
const m = {
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:    { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '12px', width: '90%', maxWidth: '820px', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:   { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px', borderBottom: '1px solid #243550', flexShrink: 0 },
  titulo:   { color: '#7dd3fc', fontWeight: '700', fontSize: '15px' },
  buscador: { marginLeft: 'auto', background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: 'white', fontSize: '13px', padding: '4px 10px', outline: 'none', width: '180px' },
  btnCerrar:{ background: 'none', border: 'none', color: '#8899aa', fontSize: '18px', cursor: 'pointer' },
  body:     { overflowY: 'auto', flex: 1 },
  tabla:    { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:       { background: '#0d1a2a', color: '#4a7fa5', padding: '8px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550', position: 'sticky', top: 0 },
  td:       { color: '#c8d8e8', padding: '7px 14px', borderBottom: '1px solid #1a2a3a' },
}
