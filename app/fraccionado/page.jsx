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

// ─── Modal de fraccionamiento ─────────────────────────────────────────────────
function ModalFraccionar({ lote, onConfirmar, onCerrar }) {
  const [kg, setKg] = useState(lote.quantity_kg)
  const porciones = lote.fraction_weight_kg
    ? Math.floor(Number(kg) / lote.fraction_weight_kg)
    : null
  const kgUsado = porciones ? porciones * lote.fraction_weight_kg : 0
  const kgResto = Number(lote.quantity_kg) - kgUsado

  return (
    <div style={m.overlay} onClick={onCerrar}>
      <div style={m.modal} onClick={e => e.stopPropagation()}>
        <div style={m.header}>
          <div>
            <h3 style={m.titulo}>{lote.product_name}</h3>
            <p style={m.subtitulo}>
              Disponible: {lote.quantity_kg} {lote.unit} ·
              Porción: {lote.fraction_weight_kg} {lote.unit} ·
              Vence: {fechaLegible(lote.expires_at)}
            </p>
          </div>
          <button style={m.btnClose} onClick={onCerrar}>✕</button>
        </div>

        <div style={m.body}>
          <label style={m.label}>Kg a fraccionar</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <input
              type="number"
              min="0"
              max={lote.quantity_kg}
              step={lote.fraction_weight_kg || 0.5}
              value={kg}
              onChange={e => setKg(Math.min(parseFloat(e.target.value) || 0, lote.quantity_kg))}
              onClick={e => e.target.select()}
              style={m.input}
            />
            <button
              style={m.btnTodo}
              onClick={() => setKg(lote.quantity_kg)}
            >
              Todo ({lote.quantity_kg} {lote.unit})
            </button>
          </div>

          {/* Resultado calculado */}
          {lote.fraction_weight_kg && (
            <div style={m.resumen}>
              <div style={m.resumenItem}>
                <span style={m.resumenLabel}>Porciones</span>
                <span style={{ ...m.resumenValor, color: '#4ade80' }}>{porciones}</span>
              </div>
              <div style={m.resumenItem}>
                <span style={m.resumenLabel}>Kg usado</span>
                <span style={m.resumenValor}>{kgUsado.toFixed(3)}</span>
              </div>
              <div style={m.resumenItem}>
                <span style={m.resumenLabel}>Resto bulk</span>
                <span style={{ ...m.resumenValor, color: kgResto > 0.001 ? '#fbbf24' : '#4ade80' }}>
                  {kgResto.toFixed(3)}
                </span>
              </div>
            </div>
          )}

          {!lote.fraction_weight_kg && (
            <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '1rem' }}>
              Este producto no tiene peso de porción definido. Configuralo en la DB antes de fraccionar.
            </p>
          )}
        </div>

        <div style={m.footer}>
          <button style={m.btnCancelar} onClick={onCerrar}>Cancelar</button>
          <button
            style={{
              ...m.btnConfirmar,
              opacity: (!porciones || porciones === 0) ? 0.5 : 1,
              cursor:  (!porciones || porciones === 0) ? 'not-allowed' : 'pointer',
            }}
            disabled={!porciones || porciones === 0}
            onClick={() => onConfirmar(lote.id, Number(kg))}
          >
            Fraccionar → {porciones} porciones
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function FraccionadoPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]           = useState('landing')
  const [tabActivo, setTabActivo]   = useState('total')
  const [datos, setDatos]           = useState(null)
  const [lotesBulk, setLotesBulk]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [loadingBulk, setLoadingBulk] = useState(false)
  const [cantidades, setCantidades] = useState({})
  const [enviando, setEnviando]     = useState(false)
  const [fraccionando, setFraccionando] = useState(null) // lote activo en modal
  const [toast, setToast]           = useState(null)
  const savingRef = useRef({})

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Cargar pedidos de sucursales ──────────────────────────────────────────
  const cargarPedidos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/fraccionado/pedidos?fecha=${fechaHoy()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
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

  // ── Cargar lotes bulk pendientes ──────────────────────────────────────────
  const cargarBulk = useCallback(async () => {
    setLoadingBulk(true)
    try {
      const res = await fetch('/api/fraccionado/bulk')
      if (!res.ok) throw new Error()
      setLotesBulk(await res.json())
    } catch {
      mostrarToast('Error al cargar bulk', 'err')
    } finally {
      setLoadingBulk(false)
    }
  }, [])

  const irAPedidos = () => { setVista('pedidos'); cargarPedidos() }
  const irABulk    = () => { setVista('bulk');    cargarBulk() }

  // ── Marcar/desmarcar → guarda en DB ──────────────────────────────────────
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
      await fetch('/api/fraccionado/marcar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, marcado, cantidad: Number(cantidades[item.id]) }),
      })
    } catch {
      mostrarToast('Error al guardar, reintentá', 'err')
    } finally {
      savingRef.current[item.id] = false
    }
  }

  const cambiarCantidad = async (item, valor) => {
    const nueva = Math.max(0, parseFloat(valor) || 0)
    setCantidades(prev => ({ ...prev, [item.id]: nueva }))
    if (item.item_status === 'IN_PRODUCTION') {
      try {
        await fetch('/api/fraccionado/marcar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, marcado: true, cantidad: nueva }),
        })
      } catch { /* silencioso */ }
    }
  }

  const toggleSucursal = async (suc, marcar) => {
    const pendientes = suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP')
    await Promise.all(pendientes.map(i => toggleMarcado(i, marcar)))
  }

  // ── Confirmar pedidos ─────────────────────────────────────────────────────
  const confirmar = async () => {
    const todosItems = datos.por_sucursal.flatMap(s => s.items)
    const enProceso  = todosItems.filter(i => i.item_status === 'IN_PRODUCTION')
    if (!enProceso.length) { mostrarToast('No hay items marcados', 'err'); return }
    if (!confirm(`¿Confirmar ${enProceso.length} item${enProceso.length > 1 ? 's' : ''} como listos?`)) return

    setEnviando(true)
    try {
      const res = await fetch('/api/fraccionado/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmaciones: enProceso.map(i => ({
            item_id: i.id, listo: true,
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

  // ── Ejecutar fraccionamiento ──────────────────────────────────────────────
  const ejecutarFraccionamiento = async (lot_id, kg_a_fraccionar) => {
    try {
      const res = await fetch('/api/fraccionado/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot_id, kg_a_fraccionar }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setFraccionando(null)
      mostrarToast(`✓ ${data.porciones} porciones generadas${data.kg_resto > 0.001 ? ` · Resto: ${data.kg_resto.toFixed(3)} kg` : ''}`)
      cargarBulk()
    } catch {
      mostrarToast('Error al fraccionar', 'err')
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

      {/* MODAL FRACCIONAR */}
      {fraccionando && (
        <ModalFraccionar
          lote={fraccionando}
          onConfirmar={ejecutarFraccionamiento}
          onCerrar={() => setFraccionando(null)}
        />
      )}

      {/* HEADER */}
      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {vista !== 'landing' && (
            <button style={s.btnBack} onClick={() => setVista('landing')}>← Volver</button>
          )}
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoCyan}>FRACCIONADO</span>
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
              {confirmados} listo{confirmados !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {vista === 'bulk' && (
          <span style={{ color: '#8899aa', fontSize: '13px' }}>
            {lotesBulk.length} lote{lotesBulk.length !== 1 ? 's' : ''} pendiente{lotesBulk.length !== 1 ? 's' : ''}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.name}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ══ LANDING ══ */}
      {vista === 'landing' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={s.titulo}>Sector Fraccionado</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button style={s.btnLanding} onClick={irAPedidos}>
              <span style={{ fontSize: '2rem' }}>📋</span>
              <span>Pedidos del día</span>
              <span style={s.btnSub}>Pedidos de sucursales</span>
            </button>
            <button style={{ ...s.btnLanding, borderColor: '#f59e0b' }} onClick={irABulk}>
              <span style={{ fontSize: '2rem' }}>🏭</span>
              <span>Bulk pendiente</span>
              <span style={s.btnSub}>Fraccionar de Cocina</span>
              {lotesBulk.length > 0 && (
                <span style={s.badgeBulk}>{lotesBulk.length}</span>
              )}
            </button>
          </div>
        </main>
      )}

      {/* ══ PEDIDOS DEL DÍA ══ */}
      {vista === 'pedidos' && (
        <main style={s.main}>
          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(tabActivo === 'total' ? s.tabActivo : {}) }}
              onClick={() => setTabActivo('total')}>Pedido total</button>
            <button style={{ ...s.tab, ...(tabActivo === 'sucursales' ? s.tabActivo : {}) }}
              onClick={() => setTabActivo('sucursales')}>Por sucursales</button>
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando...</div>
          ) : !datos ? null : (
            <>
              {/* TAB TOTAL */}
              {tabActivo === 'total' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={s.tabla}>
                    <thead>
                      <tr>
                        <th style={s.th}>Producto</th>
                        <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Total pedido</th>
                        <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Confirmado</th>
                        <th style={{ ...s.th, width: '70px' }}>Un.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.total.length === 0 ? (
                        <tr><td colSpan={4} style={{ ...s.td, textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos</td></tr>
                      ) : datos.total.map(item => (
                        <tr key={item.product_id}>
                          <td style={s.td}>{item.product_name}</td>
                          <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#7dd3fc' }}>{item.total_requested}</td>
                          <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#4ade80' }}>{item.total_confirmed || '—'}</td>
                          <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB POR SUCURSALES */}
              {tabActivo === 'sucursales' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {datos.por_sucursal.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos</p>
                  ) : datos.por_sucursal.map(suc => {
                    const itemsPend   = suc.items.filter(i => i.item_status !== 'READY_FOR_PICKUP')
                    const todosMarcados = itemsPend.length > 0 &&
                      itemsPend.every(i => i.item_status === 'IN_PRODUCTION')

                    return (
                      <div key={suc.branch_code} style={s.sucCard}>
                        <div style={s.sucHeader}>
                          <div style={s.sucSigla}>{sigla(suc.branch_name)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={s.sucNombre}>{suc.branch_name || suc.branch_code}</div>
                            <div style={s.sucFecha}>Entrega: {fechaLegible(suc.delivery_date)}</div>
                          </div>
                          {itemsPend.length > 0 && (
                            <button
                              style={{ ...s.btnToggleAll, background: todosMarcados ? '#0d2518' : '#162236', borderColor: todosMarcados ? '#22c55e' : '#243550', color: todosMarcados ? '#22c55e' : '#7a9bb8' }}
                              onClick={() => toggleSucursal(suc, !todosMarcados)}
                            >
                              {todosMarcados ? '✓ Todo' : 'Marcar todo'}
                            </button>
                          )}
                        </div>
                        <table style={s.tabla}>
                          <thead>
                            <tr>
                              <th style={s.th}>Producto</th>
                              <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Pedido</th>
                              <th style={{ ...s.th, width: '110px', textAlign: 'center' }}>Cantidad</th>
                              <th style={{ ...s.th, width: '80px', textAlign: 'center' }}>Listo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {suc.items.map(item => {
                              const yaConf   = item.item_status === 'READY_FOR_PICKUP'
                              const enProc   = item.item_status === 'IN_PRODUCTION'
                              const cant     = cantidades[item.id] ?? item.requested_quantity
                              return (
                                <tr key={item.id} style={{ background: yaConf ? '#0d2518' : enProc ? '#1a2a0a' : 'transparent' }}>
                                  <td style={{ ...s.td, textDecoration: yaConf ? 'line-through' : 'none', color: yaConf ? '#6b7280' : '#c8d8e8' }}>
                                    {item.product_name}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center', color: '#7dd3fc', fontWeight: '600' }}>
                                    {item.requested_quantity} {item.unit}
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    <input
                                      type="number" min="0" value={cant} disabled={yaConf}
                                      onChange={e => cambiarCantidad(item, e.target.value)}
                                      onClick={e => e.target.select()}
                                      style={{ ...s.inputCantidad, opacity: yaConf ? 0.5 : 1, cursor: yaConf ? 'not-allowed' : 'text', borderColor: Number(cant) !== item.requested_quantity ? '#f59e0b' : '#243550' }}
                                    />
                                  </td>
                                  <td style={{ ...s.td, textAlign: 'center' }}>
                                    {yaConf ? (
                                      <span style={{ color: '#4ade80', fontWeight: '700', fontSize: '16px' }}>✓</span>
                                    ) : (
                                      <input type="checkbox" checked={enProc}
                                        onChange={e => toggleMarcado(item, e.target.checked)}
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

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '1.5rem', paddingBottom: '2rem' }}>
                <button style={s.btnRecargar} onClick={cargarPedidos}>↻ Recargar</button>
                <button
                  style={{ ...s.btnConfirmar, opacity: (!enProceso || enviando) ? 0.5 : 1, cursor: (!enProceso || enviando) ? 'not-allowed' : 'pointer' }}
                  onClick={confirmar} disabled={!enProceso || enviando}
                >
                  {enviando ? 'Confirmando...' : `✓ Confirmar listos${enProceso > 0 ? ` (${enProceso})` : ''}`}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* ══ BULK PENDIENTE ══ */}
      {vista === 'bulk' && (
        <main style={s.main}>
          <p style={s.subtitulo}>Lotes bulk de Cocina pendientes de fraccionar</p>
          <p style={{ color: '#8899aa', fontSize: '12px', textAlign: 'center', marginBottom: '1.5rem' }}>
            Ordenados por fecha de vencimiento. Fraccionar primero los más próximos a vencer.
          </p>

          {loadingBulk ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando...</div>
          ) : lotesBulk.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
              <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</p>
              <p>No hay bulk pendiente de fraccionar</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {lotesBulk.map(lote => (
                <div key={lote.id} style={{
                  ...s.loteCard,
                  borderColor: lote.dias_restantes <= 1 ? '#ef4444' :
                               lote.dias_restantes <= 2 ? '#f59e0b' : '#243550',
                }}>
                  <div style={s.loteInfo}>
                    <div style={s.loteNombre}>{lote.product_name}</div>
                    <div style={s.loteDatos}>
                      <span style={{ color: '#7dd3fc', fontWeight: '700' }}>{lote.quantity_kg} {lote.unit}</span>
                      <span style={{ color: '#8899aa' }}>·</span>
                      <span>Porción: {lote.fraction_weight_kg ?? '—'} {lote.unit}</span>
                      <span style={{ color: '#8899aa' }}>·</span>
                      <span>{lote.porciones_posibles ?? '—'} porciones posibles</span>
                      <span style={{ color: '#8899aa' }}>·</span>
                      <span style={{
                        color: lote.dias_restantes <= 1 ? '#ef4444' :
                               lote.dias_restantes <= 2 ? '#fbbf24' : '#4ade80',
                        fontWeight: '600',
                      }}>
                        {lote.dias_restantes === 0 ? 'Vence HOY' :
                         lote.dias_restantes === 1 ? 'Vence mañana' :
                         `Vence en ${lote.dias_restantes} días`}
                      </span>
                    </div>
                  </div>
                  <button
                    style={s.btnFraccionar}
                    onClick={() => setFraccionando(lote)}
                  >
                    Fraccionar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingBottom: '2rem' }}>
            <button style={s.btnRecargar} onClick={cargarBulk}>↻ Recargar</button>
          </div>
        </main>
      )}
    </div>
  )
}

// ─── Estilos modal ────────────────────────────────────────────────────────────
const m = {
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' },
  modal:        { background: '#162236', border: '1px solid #243550', borderRadius: '12px', width: '100%', maxWidth: '500px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:       { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '1.25rem', borderBottom: '1px solid #243550' },
  titulo:       { color: 'white', fontSize: '1rem', fontWeight: '700', margin: 0 },
  subtitulo:    { color: '#8899aa', fontSize: '12px', marginTop: '4px' },
  btnClose:     { background: 'none', border: 'none', color: '#8899aa', fontSize: '18px', cursor: 'pointer' },
  body:         { padding: '1.25rem' },
  label:        { color: '#7a9bb8', fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.04em' },
  input:        { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '6px', color: 'white', fontSize: '18px', fontWeight: '700', padding: '8px 12px', width: '120px', textAlign: 'center', outline: 'none' },
  btnTodo:      { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '12px', padding: '6px 12px', cursor: 'pointer' },
  resumen:      { display: 'flex', gap: '12px', background: '#0f1c2e', borderRadius: '8px', padding: '12px' },
  resumenItem:  { flex: 1, textAlign: 'center' },
  resumenLabel: { color: '#8899aa', fontSize: '11px', display: 'block', marginBottom: '4px', textTransform: 'uppercase' },
  resumenValor: { color: 'white', fontSize: '20px', fontWeight: '700' },
  footer:       { padding: '1rem 1.25rem', borderTop: '1px solid #243550', display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  btnCancelar:  { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '8px 16px', cursor: 'pointer' },
  btnConfirmar: { background: '#22c55e', border: 'none', borderRadius: '6px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '8px 20px' },
}

// ─── Estilos página ───────────────────────────────────────────────────────────
const s = {
  page:         { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0, gap: '12px' },
  logoBlanco:   { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:     { color: '#34d399', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  userLabel:    { color: '#8899aa', fontSize: '13px' },
  btnSalir:     { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:      { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  progreso:     { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  progresoBadge:{ fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '10px' },
  main:         { flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:       { color: 'white', fontSize: '1.5rem', fontWeight: '700', textAlign: 'center' },
  subtitulo:    { color: '#7a9bb8', fontSize: '14px', textAlign: 'center', marginBottom: '1rem' },
  btnLanding:   { background: '#162236', border: '2px solid #34d399', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: '700', padding: '2rem 2.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '200px', position: 'relative' },
  btnSub:       { color: '#8899aa', fontSize: '11px', fontWeight: '400' },
  badgeBulk:    { position: 'absolute', top: '8px', right: '8px', background: '#f59e0b', color: '#0f1c2e', fontSize: '11px', fontWeight: '700', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  tabs:         { display: 'flex', gap: '4px', marginBottom: '1rem', borderBottom: '1px solid #243550' },
  tab:          { background: 'none', border: 'none', color: '#8899aa', fontSize: '14px', fontWeight: '600', padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:    { color: '#34d399', borderBottom: '2px solid #34d399' },
  tabla:        { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:           { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550', position: 'sticky', top: 0 },
  td:           { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  inputCantidad:{ background: '#0f1c2e', border: '1px solid', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '80px', textAlign: 'center', outline: 'none' },
  sucCard:      { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  sucHeader:    { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550' },
  sucSigla:     { background: '#34d399', color: '#0f1c2e', fontWeight: '900', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', letterSpacing: '1px' },
  sucNombre:    { color: 'white', fontWeight: '700', fontSize: '14px' },
  sucFecha:     { color: '#8899aa', fontSize: '11px' },
  btnToggleAll: { border: '1px solid', borderRadius: '6px', fontSize: '12px', fontWeight: '600', padding: '5px 12px', cursor: 'pointer' },
  loteCard:     { background: '#162236', border: '1px solid', borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
  loteInfo:     { flex: 1 },
  loteNombre:   { color: 'white', fontWeight: '700', fontSize: '14px', marginBottom: '6px' },
  loteDatos:    { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: '#c8d8e8' },
  btnFraccionar:{ background: '#34d399', border: 'none', borderRadius: '7px', color: '#0f1c2e', fontSize: '13px', fontWeight: '700', padding: '8px 20px', cursor: 'pointer', flexShrink: 0 },
  btnRecargar:  { background: 'none', border: '1px solid #243550', borderRadius: '7px', color: '#7a9bb8', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer' },
  btnConfirmar: { background: '#22c55e', border: 'none', borderRadius: '7px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '10px 24px', cursor: 'pointer' },
  toast:        { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
