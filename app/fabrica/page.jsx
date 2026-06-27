'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'

function fechaHoy() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).split('/').reverse().join('-')
}

function fechaLegible(str) {
  if (!str) return ''
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(str))
}

function sigla(nombre) {
  if (!nombre) return '?'
  return nombre.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4)
}

export default function FabricaPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]             = useState('landing')
  const [tabActivo, setTabActivo]     = useState('total')
  const [datos, setDatos]             = useState(null)
  const [loading, setLoading]         = useState(false)
  const [cantidades, setCantidades]   = useState({})
  const [enviando, setEnviando]       = useState(false)
  const [fueraHorario, setFueraHorario] = useState(null)
  const [toast, setToast]             = useState(null)
  const savingRef = useRef({})

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargarPedidos = useCallback(async () => {
    setLoading(true)
    setFueraHorario(null)
    try {
      const res = await fetch(`/api/fabrica/pedidos?fecha=${fechaHoy()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()

      if (data.fuera_de_horario) {
        setFueraHorario(data.mensaje)
        setDatos(null)
        return
      }

      setDatos(data)
      const initCant = {}
      data.por_sucursal.forEach(suc => {
        suc.items.forEach(item => {
          initCant[item.id] = item.confirmed_quantity ?? item.requested_quantity
        })
      })
      setCantidades(initCant)
    } catch {
      mostrarToast('Error al cargar pedidos', 'err')
    } finally {
      setLoading(false)
    }
  }, [])

  const irAPedidos = () => {
    setVista('pedidos')
    cargarPedidos()
  }

  // ── Marcar/desmarcar → guarda en DB inmediatamente ────────────────────────
  const toggleMarcado = async (item, marcado) => {
    if (savingRef.current[item.id]) return
    savingRef.current[item.id] = true

    setDatos(prev => ({
      ...prev,
      por_sucursal: prev.por_sucursal.map(suc => ({
        ...suc,
        items: suc.items.map(i =>
          i.id === item.id
            ? { ...i, item_status: marcado ? 'IN_PRODUCTION' : 'PENDING_CONFIRMATION' }
            : i
        ),
      })),
    }))

    try {
      await fetch('/api/fabrica/marcar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, marcado, cantidad: Number(cantidades[item.id]) }),
      })
    } catch {
      mostrarToast('Error al guardar, reintentá', 'err')
      setDatos(prev => ({
        ...prev,
        por_sucursal: prev.por_sucursal.map(suc => ({
          ...suc,
          items: suc.items.map(i => i.id === item.id ? { ...i, item_status: item.item_status } : i),
        })),
      }))
    } finally {
      savingRef.current[item.id] = false
    }
  }

  // ── Cambiar cantidad → guarda si está marcado ─────────────────────────────
  const cambiarCantidad = async (item, valor) => {
    const nueva = Math.max(0, parseFloat(valor) || 0)
    setCantidades(prev => ({ ...prev, [item.id]: nueva }))
    if (item.item_status === 'IN_PRODUCTION') {
      try {
        await fetch('/api/fabrica/marcar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, marcado: true, cantidad: nueva }),
        })
      } catch { /* silencioso */ }
    }
  }

  // ── Marcar toda una sucursal ──────────────────────────────────────────────
  const toggleSucursal = async (suc, marcar) => {
    const pendientes = suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP')
    await Promise.all(pendientes.map(i => toggleMarcado(i, marcar)))
  }

  // ── Confirmar todos los IN_PRODUCTION ─────────────────────────────────────
  const confirmar = async () => {
    const todosItems = datos.por_sucursal.flatMap(s => s.items)
    const enProceso  = todosItems.filter(i => i.item_status === 'IN_PRODUCTION')

    if (!enProceso.length) {
      mostrarToast('No hay items marcados para confirmar', 'err')
      return
    }
    if (!confirm(`¿Confirmar ${enProceso.length} item${enProceso.length > 1 ? 's' : ''} como producidos?`)) return

    setEnviando(true)
    try {
      const res = await fetch('/api/fabrica/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmaciones: enProceso.map(i => ({
            item_id:            i.id,
            listo:              true,
            confirmed_quantity: Number(cantidades[i.id]),
          })),
        }),
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

  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  const todosItems  = datos?.por_sucursal?.flatMap(s => s.items) || []
  const enProceso   = todosItems.filter(i => i.item_status === 'IN_PRODUCTION').length
  const confirmados = todosItems.filter(i => i.item_status === 'READY_FOR_PICKUP').length
  const pendientes  = todosItems.filter(i => i.item_status === 'PENDING_CONFIRMATION').length

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {vista !== 'landing' && (
            <button style={s.btnBack} onClick={() => setVista('landing')}>← Volver</button>
          )}
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoCyan}>FÁBRICA</span>
        </div>

        {vista === 'pedidos' && datos && (
          <div style={s.progreso}>
            <span style={{ ...s.progresoBadge, background: '#1a2a3a', color: '#7dd3fc' }}>
              {pendientes} pendiente{pendientes !== 1 ? 's' : ''}
            </span>
            <span style={{ ...s.progresoBadge, background: '#1a2a1a', color: '#fbbf24' }}>
              {enProceso} en proceso
            </span>
            <span style={{ ...s.progresoBadge, background: '#0d2518', color: '#4ade80' }}>
              {confirmados} confirmado{confirmados !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.name}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ══ LANDING ══ */}
      {vista === 'landing' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={s.titulo}>Sector Fábrica</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button style={s.btnLanding} onClick={irAPedidos}>
              <span style={{ fontSize: '2rem' }}>⚙️</span>
              <span>Pedidos del día</span>
              <span style={s.btnSub}>Ver y confirmar producción</span>
            </button>
          </div>
          <p style={{ color: '#8899aa', fontSize: '12px', marginTop: '1rem' }}>
            Los pedidos de Fábrica se reciben hasta las 14:30 hs
          </p>
        </main>
      )}

      {/* ══ PEDIDOS ══ */}
      {vista === 'pedidos' && (
        <main style={s.main}>

          {/* Aviso fuera de horario */}
          {fueraHorario && (
            <div style={s.avisoHorario}>
              <span style={{ fontSize: '1.5rem' }}>⏰</span>
              <div>
                <p style={{ fontWeight: '700', color: '#fbbf24' }}>Fuera de horario</p>
                <p style={{ fontSize: '13px', color: '#d1d5db' }}>{fueraHorario}</p>
              </div>
            </div>
          )}

          {/* Tabs */}
          {!fueraHorario && (
            <div style={s.tabs}>
              <button style={{ ...s.tab, ...(tabActivo === 'total' ? s.tabActivo : {}) }}
                onClick={() => setTabActivo('total')}>
                Pedido total
              </button>
              <button style={{ ...s.tab, ...(tabActivo === 'sucursales' ? s.tabActivo : {}) }}
                onClick={() => setTabActivo('sucursales')}>
                Por sucursales
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando pedidos...</div>
          ) : !datos ? null : (
            <>
              {/* ── TAB TOTAL ── */}
              {tabActivo === 'total' && (
                <div>
                  <p style={s.subtitulo}>Producción total para hoy</p>
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
                          <tr>
                            <td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#8899aa', padding: '2rem' }}>
                              Sin pedidos pendientes
                            </td>
                          </tr>
                        ) : datos.total.map(item => (
                          <tr key={item.product_id}>
                            <td style={s.td}>{item.product_name}</td>
                            <td style={{ ...s.td, fontSize: '11px', color: '#8899aa' }}>
                              {item.sub_condition || '—'}
                            </td>
                            <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#7dd3fc' }}>
                              {item.total_requested}
                            </td>
                            <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#4ade80' }}>
                              {item.total_confirmed || '—'}
                            </td>
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
                    <p style={{ textAlign: 'center', color: '#8899aa', padding: '2rem' }}>
                      Sin pedidos pendientes
                    </p>
                  ) : datos.por_sucursal.map(suc => {
                    const itemsPendientes = suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP')
                    const itemsEnProceso  = suc.items.filter(i => i.item_status === 'IN_PRODUCTION')
                    const todosMarcados   = itemsPendientes.length > 0 &&
                      itemsPendientes.every(i => i.item_status === 'IN_PRODUCTION')

                    return (
                      <div key={suc.branch_code} style={s.sucCard}>
                        <div style={s.sucHeader}>
                          <div style={s.sucSigla}>{sigla(suc.branch_name)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={s.sucNombre}>{suc.branch_name || suc.branch_code}</div>
                            <div style={s.sucFecha}>
                              Entrega: {fechaLegible(suc.delivery_date)}
                              {itemsEnProceso.length > 0 && (
                                <span style={{ marginLeft: '8px', color: '#fbbf24', fontSize: '11px' }}>
                                  · {itemsEnProceso.length} en proceso
                                </span>
                              )}
                            </div>
                          </div>
                          {itemsPendientes.length > 0 && (
                            <button
                              style={{
                                ...s.btnToggleAll,
                                background:  todosMarcados ? '#0d2518' : '#162236',
                                borderColor: todosMarcados ? '#22c55e' : '#243550',
                                color:       todosMarcados ? '#22c55e' : '#7a9bb8',
                              }}
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
                              <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Producir</th>
                              <th style={{ ...s.th, width: '90px', textAlign: 'center' }}>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suc.items.map(item => {
                              const yaConfirmado = item.item_status === 'READY_FOR_PICKUP'
                              const enProcItem   = item.item_status === 'IN_PRODUCTION'
                              const cant         = cantidades[item.id] ?? item.requested_quantity

                              return (
                                <tr key={item.id} style={{
                                  background: yaConfirmado ? '#0d2518' :
                                              enProcItem  ? '#1a2a0a' : 'transparent',
                                }}>
                                  <td style={{
                                    ...s.td,
                                    textDecoration: yaConfirmado ? 'line-through' : 'none',
                                    color: yaConfirmado ? '#6b7280' : '#c8d8e8',
                                  }}>
                                    {item.product_name}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center', color: '#7dd3fc', fontWeight: '600' }}>
                                    {item.requested_quantity} {item.unit}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={cant}
                                      disabled={yaConfirmado}
                                      onChange={e => cambiarCantidad(item, e.target.value)}
                                      onClick={e => e.target.select()}
                                      style={{
                                        ...s.inputCantidad,
                                        opacity:     yaConfirmado ? 0.5 : 1,
                                        cursor:      yaConfirmado ? 'not-allowed' : 'text',
                                        borderColor: Number(cant) !== item.requested_quantity
                                          ? '#f59e0b' : '#243550',
                                      }}
                                    />
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    {yaConfirmado ? (
                                      <span style={{ color: '#4ade80', fontWeight: '700', fontSize: '16px' }}>✓</span>
                                    ) : (
                                      <input
                                        type="checkbox"
                                        checked={enProcItem}
                                        onChange={e => toggleMarcado(item, e.target.checked)}
                                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#fbbf24' }}
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

              {/* Acciones */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem', paddingBottom: '2rem' }}>
                <button style={s.btnRecargar} onClick={cargarPedidos}>↻ Recargar</button>
                <button
                  style={{
                    ...s.btnConfirmar,
                    opacity: (!enProceso || enviando) ? 0.5 : 1,
                    cursor:  (!enProceso || enviando) ? 'not-allowed' : 'pointer',
                  }}
                  onClick={confirmar}
                  disabled={!enProceso || enviando}
                >
                  {enviando ? 'Confirmando...' : `✓ Confirmar producidos${enProceso > 0 ? ` (${enProceso})` : ''}`}
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
  page:         { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0, gap: '12px' },
  logoBlanco:   { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:     { color: '#a78bfa', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  userLabel:    { color: '#8899aa', fontSize: '13px' },
  btnSalir:     { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:      { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  progreso:     { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  progresoBadge:{ fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '10px' },
  main:         { flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:       { color: 'white', fontSize: '1.5rem', fontWeight: '700', textAlign: 'center' },
  subtitulo:    { color: '#7a9bb8', fontSize: '14px', textAlign: 'center', marginBottom: '1rem' },
  btnLanding:   { background: '#162236', border: '2px solid #a78bfa', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: '700', padding: '2rem 2.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '200px' },
  btnSub:       { color: '#8899aa', fontSize: '11px', fontWeight: '400' },
  avisoHorario: { background: '#1c1000', border: '1px solid #92400e', borderRadius: '10px', padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '1rem' },
  tabs:         { display: 'flex', gap: '4px', marginBottom: '1rem', borderBottom: '1px solid #243550' },
  tab:          { background: 'none', border: 'none', color: '#8899aa', fontSize: '14px', fontWeight: '600', padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:    { color: '#a78bfa', borderBottom: '2px solid #a78bfa' },
  tabla:        { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:           { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550', position: 'sticky', top: 0 },
  td:           { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  inputCantidad:{ background: '#0f1c2e', border: '1px solid', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '80px', textAlign: 'center', outline: 'none' },
  sucCard:      { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  sucHeader:    { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550' },
  sucSigla:     { background: '#a78bfa', color: '#0f1c2e', fontWeight: '900', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', letterSpacing: '1px' },
  sucNombre:    { color: 'white', fontWeight: '700', fontSize: '14px' },
  sucFecha:     { color: '#8899aa', fontSize: '11px' },
  btnToggleAll: { border: '1px solid', borderRadius: '6px', fontSize: '12px', fontWeight: '600', padding: '5px 12px', cursor: 'pointer' },
  btnRecargar:  { background: 'none', border: '1px solid #243550', borderRadius: '7px', color: '#7a9bb8', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer' },
  btnConfirmar: { background: '#22c55e', border: 'none', borderRadius: '7px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '10px 24px', cursor: 'pointer' },
  toast:        { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
