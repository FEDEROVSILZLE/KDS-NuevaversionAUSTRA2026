'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

// Devuelve YYYY-MM-DD en timezone Argentina, con offset de días
function fechaEnAR(offsetDias = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDias)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d)
}

function fechaLegible(str) {
  if (!str) return '—'
  const soloFecha = typeof str === 'string' ? str.split('T')[0] : str
  const d = new Date(soloFecha + 'T12:00:00')
  if (isNaN(d)) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(d)
}

function sigla(nombre) {
  if (!nombre) return '?'
  return nombre.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4)
}

export default function DepositoPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]                   = useState('landing')
  const [tabActivo, setTabActivo]           = useState('total')
  const [datos, setDatos]                   = useState(null)
  const [loading, setLoading]               = useState(false)
  const [cantidades, setCantidades]         = useState({})
  const [listos, setListos]                 = useState({})
  const [enviando, setEnviando]             = useState(false)
  const [toast, setToast]                   = useState(null)
  // Default: mañana (pedidos hechos anoche)
  const [fechaSeleccionada, setFechaSeleccionada] = useState(fechaEnAR(1))

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargarPedidos = useCallback(async (fecha) => {
    setLoading(true)
    const f = fecha || fechaSeleccionada
    try {
      const res = await fetch(`/api/deposito/pedidos?fecha=${f}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDatos(data)

      const initCant = {}
      const initListos = {}
      data.por_sucursal.forEach(suc => {
        suc.items.forEach(item => {
          initCant[item.id]   = item.confirmed_quantity ?? item.requested_quantity
          initListos[item.id] = item.item_status === 'READY_FOR_PICKUP'
        })
      })
      setCantidades(initCant)
      setListos(initListos)
    } catch {
      mostrarToast('Error al cargar pedidos', 'err')
    } finally {
      setLoading(false)
    }
  }, [fechaSeleccionada])

  const cambiarFecha = (nuevaFecha) => {
    setFechaSeleccionada(nuevaFecha)
    setDatos(null)
    cargarPedidos(nuevaFecha)
  }

  const irAPedidos = () => {
    setVista('pedidos')
    cargarPedidos()
  }

  const confirmar = async () => {
    const payload = Object.entries(listos)
      .filter(([, listo]) => listo)
      .map(([item_id]) => ({
        item_id,
        listo: true,
        confirmed_quantity: Number(cantidades[item_id]),
      }))

    if (!payload.length) { mostrarToast('Marcá al menos un item como listo', 'err'); return }
    if (!confirm(`¿Confirmar ${payload.length} item${payload.length > 1 ? 's' : ''} como pickeados?`)) return

    setEnviando(true)
    try {
      const res = await fetch('/api/deposito/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmaciones: payload }),
      })
      if (!res.ok) throw new Error()
      const { confirmados } = await res.json()
      mostrarToast(`${confirmados} item${confirmados > 1 ? 's' : ''} confirmado${confirmados > 1 ? 's' : ''} ✓`)
      cargarPedidos()
    } catch {
      mostrarToast('Error al confirmar', 'err')
    } finally {
      setEnviando(false)
    }
  }

  const toggleSucursal = (suc, valor) => {
    const update = {}
    suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP').forEach(i => { update[i.id] = valor })
    setListos(prev => ({ ...prev, ...update }))
  }

  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  const hayListos    = Object.values(listos).some(Boolean)
  const totalListos  = Object.values(listos).filter(Boolean).length

  return (
    <div style={s.page}>

      {toast && (
        <div style={{ ...s.toast, background: toast.tipo === 'err' ? '#7f1d1d' : '#14532d', borderColor: toast.tipo === 'err' ? '#ef4444' : '#22c55e' }}>
          {toast.msg}
        </div>
      )}

      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {vista !== 'landing' && (
            <button style={s.btnBack} onClick={() => setVista('landing')}>← Volver</button>
          )}
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoCyan}>DEPÓSITO</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.name}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ══ LANDING ══ */}
      {vista === 'landing' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={s.titulo}>Sector Depósito</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button style={s.btnLanding} onClick={irAPedidos}>
              <span style={{ fontSize: '2rem' }}>📦</span>
              <span>Pedidos del día</span>
              <span style={s.btnSub}>Ver y pickear mercadería</span>
            </button>
          </div>
        </main>
      )}

      {/* ══ PEDIDOS ══ */}
      {vista === 'pedidos' && (
        <main style={s.main}>

          {/* ── Selector de fecha ── */}
          <div style={s.fechaBar}>
            <button
              style={{ ...s.btnFechaShortcut, ...(fechaSeleccionada === fechaEnAR(0) ? s.btnFechaActivo : {}) }}
              onClick={() => cambiarFecha(fechaEnAR(0))}
            >
              Hoy
            </button>
            <button
              style={{ ...s.btnFechaShortcut, ...(fechaSeleccionada === fechaEnAR(1) ? s.btnFechaActivo : {}) }}
              onClick={() => cambiarFecha(fechaEnAR(1))}
            >
              Mañana
            </button>
            <input
              type="date"
              value={fechaSeleccionada}
              onChange={e => cambiarFecha(e.target.value)}
              style={s.inputFecha}
            />
            <span style={s.fechaLabel}>
              Pendientes hasta: <strong style={{ color: '#7dd3fc' }}>{fechaLegible(fechaSeleccionada)}</strong>
            </span>
          </div>

          {/* Tabs */}
          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(tabActivo === 'total' ? s.tabActivo : {}) }} onClick={() => setTabActivo('total')}>
              Pedido total
            </button>
            <button style={{ ...s.tab, ...(tabActivo === 'sucursales' ? s.tabActivo : {}) }} onClick={() => setTabActivo('sucursales')}>
              Por sucursales
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando pedidos...</div>
          ) : !datos ? null : (
            <>
              {/* ── TAB TOTAL ── */}
              {tabActivo === 'total' && (
                <div>
                  <p style={s.subtitulo}>Mercadería total a pickear — pendientes hasta {fechaLegible(fechaSeleccionada)}</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={s.tabla}>
                      <thead>
                        <tr>
                          <th style={s.th}>Producto</th>
                          <th style={{ ...s.th, width: '80px' }}>Categoría</th>
                          <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Total pedido</th>
                          <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Confirmado</th>
                          <th style={{ ...s.th, width: '70px' }}>Un.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {datos.total.length === 0 ? (
                          <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos pendientes para esta fecha</td></tr>
                        ) : datos.total.map(item => (
                          <tr key={item.product_id}>
                            <td style={s.td}>{item.product_name}</td>
                            <td style={{ ...s.td, fontSize: '11px', color: '#8899aa' }}>{item.sub_condition || '—'}</td>
                            <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#7dd3fc' }}>{item.total_requested}</td>
                            <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#4ade80' }}>{item.total_confirmed || '—'}</td>
                            <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{item.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── TAB POR SUCURSALES ── */}
              {tabActivo === 'sucursales' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {datos.por_sucursal.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos pendientes para esta fecha</p>
                  ) : datos.por_sucursal.map(suc => {
                    const pendientes    = suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP')
                    const todosMarcados = pendientes.length > 0 && pendientes.every(i => listos[i.id])

                    return (
                      <div key={suc.branch_code} style={s.sucCard}>
                        <div style={s.sucHeader}>
                          <div style={s.sucSigla}>{sigla(suc.branch_name)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={s.sucNombre}>{suc.branch_name || suc.branch_code}</div>
                            <div style={s.sucFecha}>Entrega: {fechaLegible(suc.delivery_date)}</div>
                          </div>
                          {pendientes.length > 0 && (
                            <button
                              style={{ ...s.btnToggleAll, background: todosMarcados ? '#0d2518' : '#162236', borderColor: todosMarcados ? '#22c55e' : '#243550', color: todosMarcados ? '#22c55e' : '#7a9bb8' }}
                              onClick={() => toggleSucursal(suc, !todosMarcados)}
                            >
                              {todosMarcados ? '✓ Todo marcado' : 'Marcar todo'}
                            </button>
                          )}
                        </div>

                        <table style={s.tabla}>
                          <thead>
                            <tr>
                              <th style={s.th}>Producto</th>
                              <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Pedido</th>
                              <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Cantidad</th>
                              <th style={{ ...s.th, width: '80px', textAlign: 'center' }}>Pickeado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suc.items.map(item => {
                              const estaListo    = listos[item.id] || false
                              const yaConfirmado = item.item_status === 'READY_FOR_PICKUP'
                              const cant         = cantidades[item.id] ?? item.requested_quantity

                              return (
                                <tr key={item.id} style={{ background: estaListo || yaConfirmado ? '#0d2518' : 'transparent' }}>
                                  <td style={{ ...s.td, textDecoration: yaConfirmado ? 'line-through' : 'none', color: yaConfirmado ? '#6b7280' : '#c8d8e8' }}>
                                    {item.product_name}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center', color: '#7dd3fc', fontWeight: '600' }}>
                                    {item.requested_quantity} {item.unit}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    <input
                                      type="number" min="0" value={cant}
                                      disabled={yaConfirmado}
                                      onChange={e => setCantidades(prev => ({ ...prev, [item.id]: Math.max(0, parseFloat(e.target.value) || 0) }))}
                                      onClick={e => e.target.select()}
                                      style={{ ...s.inputCantidad, opacity: yaConfirmado ? 0.5 : 1, cursor: yaConfirmado ? 'not-allowed' : 'text', borderColor: Number(cant) !== item.requested_quantity ? '#f59e0b' : '#243550' }}
                                    />
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    {yaConfirmado ? (
                                      <span style={{ color: '#22c55e', fontWeight: '700', fontSize: '16px' }}>✓</span>
                                    ) : (
                                      <input type="checkbox" checked={estaListo}
                                        onChange={e => setListos(prev => ({ ...prev, [item.id]: e.target.checked }))}
                                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#22c55e' }}
                                      />
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem', paddingBottom: '2rem' }}>
                <button style={s.btnRecargar} onClick={() => cargarPedidos()}>↻ Recargar</button>
                <button
                  style={{ ...s.btnConfirmar, opacity: (!hayListos || enviando) ? 0.5 : 1, cursor: (!hayListos || enviando) ? 'not-allowed' : 'pointer' }}
                  onClick={confirmar} disabled={!hayListos || enviando}
                >
                  {enviando ? 'Confirmando...' : `✓ Confirmar pickeados${totalListos > 0 ? ` (${totalListos})` : ''}`}
                </button>
              </div>
            </>
          )}
        </main>
      )}
    </div>
  )
}

const s = {
  page:              { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:            { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0 },
  logoBlanco:        { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:          { color: '#60a5fa', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  userLabel:         { color: '#8899aa', fontSize: '13px' },
  btnSalir:          { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:           { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  main:              { flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:            { color: 'white', fontSize: '1.5rem', fontWeight: '700', textAlign: 'center' },
  subtitulo:         { color: '#7a9bb8', fontSize: '14px', textAlign: 'center', marginBottom: '1rem' },
  btnLanding:        { background: '#162236', border: '2px solid #60a5fa', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: '700', padding: '2rem 2.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '200px' },
  btnSub:            { color: '#8899aa', fontSize: '11px', fontWeight: '400' },
  // Selector de fecha
  fechaBar:          { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', padding: '10px 14px', background: '#0d1a2a', borderRadius: '8px', border: '1px solid #1e3050' },
  btnFechaShortcut:  { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '12px', fontWeight: '600', padding: '5px 14px', cursor: 'pointer' },
  btnFechaActivo:    { background: '#1e3a5f', border: '1px solid #60a5fa', color: '#60a5fa' },
  inputFecha:        { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#c8d8e8', fontSize: '13px', padding: '5px 10px', cursor: 'pointer', outline: 'none' },
  fechaLabel:        { color: '#8899aa', fontSize: '12px', marginLeft: '4px' },
  // Resto
  tabs:              { display: 'flex', gap: '4px', marginBottom: '1rem', borderBottom: '1px solid #243550' },
  tab:               { background: 'none', border: 'none', color: '#8899aa', fontSize: '14px', fontWeight: '600', padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:         { color: '#60a5fa', borderBottom: '2px solid #60a5fa' },
  tabla:             { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:                { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550', position: 'sticky', top: 0 },
  td:                { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  inputCantidad:     { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '80px', textAlign: 'center', outline: 'none' },
  sucCard:           { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  sucHeader:         { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550' },
  sucSigla:          { background: '#60a5fa', color: '#0f1c2e', fontWeight: '900', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', letterSpacing: '1px' },
  sucNombre:         { color: 'white', fontWeight: '700', fontSize: '14px' },
  sucFecha:          { color: '#8899aa', fontSize: '11px' },
  btnToggleAll:      { border: '1px solid', borderRadius: '6px', fontSize: '12px', fontWeight: '600', padding: '5px 12px', cursor: 'pointer' },
  btnRecargar:       { background: 'none', border: '1px solid #243550', borderRadius: '7px', color: '#7a9bb8', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer' },
  btnConfirmar:      { background: '#22c55e', border: 'none', borderRadius: '7px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '10px 24px', cursor: 'pointer' },
  toast:             { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
