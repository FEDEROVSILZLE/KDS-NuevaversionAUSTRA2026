'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

// ── Helpers globales ──────────────────────────────────────────────────────────
function tsAR(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function fechaAR(iso) {
  if (!iso) return '—'
  const d = typeof iso === 'string' && iso.length === 10
    ? new Date(iso + 'T12:00:00')
    : new Date(iso)
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
}

function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

const STATUS_LABEL = {
  DRAFT:                'Borrador',
  PENDING_CONFIRMATION: 'Pendiente',
  CONFIRMED_PARTIAL:    'Conf. parcial',
  IN_PRODUCTION:        'En producción',
  READY_FOR_PICKUP:     'Listo',
  DISPATCHED:           'Despachado',
  DELIVERED:            'Entregado',
  CANCELLED:            'Cancelado',
}
const STATUS_COLOR = {
  DRAFT:                '#4a7fa5',
  PENDING_CONFIRMATION: '#f59e0b',
  CONFIRMED_PARTIAL:    '#a78bfa',
  IN_PRODUCTION:        '#38bdf8',
  READY_FOR_PICKUP:     '#4ade80',
  DISPATCHED:           '#34d399',
  DELIVERED:            '#22c55e',
  CANCELLED:            '#6b7280',
}

const NAV_ITEMS = [
  { id: 'catalogo', label: '📦 Catálogo & Stock'    },
  { id: 'estado',   label: '🟢 Estado en vivo'      },
  { id: 'pedidos',  label: '📋 Pedidos'              },
  { id: 'dashboard',label: '📊 Dashboard'            },
]

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [seccion, setSeccion] = useState('catalogo')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  if (status === 'loading') {
    return <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoAmarillo}>ADMIN</span>
          <span style={s.headerSub}>Base de Operaciones</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.sector}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      <div style={s.shell}>
        <nav style={s.sidebar}>
          <p style={s.sidebarTitulo}>Módulos</p>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              style={{ ...s.navBtn, ...(seccion === item.id ? s.navBtnActivo : {}) }}
              onClick={() => setSeccion(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main style={s.main}>
          {seccion === 'catalogo'  && <SeccionCatalogo />}
          {seccion === 'estado'    && <SeccionEstado />}
          {seccion === 'pedidos'   && <SeccionPedidos />}
          {seccion === 'dashboard' && <SeccionDashboard />}
        </main>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO B — Catálogo & Stock
// ═══════════════════════════════════════════════════════════════════════════════
function SeccionCatalogo() {
  const [sectores,     setSectores]     = useState([])
  const [sectorId,     setSectorId]     = useState('')
  const [modoAlertas,  setModoAlertas]  = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [productos,    setProductos]    = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [pagina,       setPagina]       = useState(0)
  const POR_PAGINA = 80

  useEffect(() => {
    fetch('/api/admin/sectores')
      .then(r => r.json())
      .then(d => { if (!d.error) setSectores(d) })
      .catch(() => {})
  }, [])

  const cargar = useCallback(async () => {
    setLoading(true); setError(null); setPagina(0)
    try {
      const p = new URLSearchParams()
      if (modoAlertas) { p.set('alertas', 'true') }
      else { if (sectorId) p.set('sector_id', sectorId); if (buscar) p.set('buscar', buscar) }
      const res  = await fetch(`/api/admin/catalogo?${p}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error del servidor')
      setProductos(data)
    } catch (e) { setError(e.message); setProductos([]) }
    finally     { setLoading(false) }
  }, [sectorId, buscar, modoAlertas])

  useEffect(() => { cargar() }, [modoAlertas]) // eslint-disable-line

  const sectorNombre = sectores.find(x => x.id === parseInt(sectorId))?.name || null
  const totalPags    = Math.ceil(productos.length / POR_PAGINA)
  const paginados    = productos.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)

  function stockColor(st) {
    if (st === 'BAJO')   return { color: '#fca5a5', bg: '#3b0a0a' }
    if (st === 'EXCESO') return { color: '#fde68a', bg: '#2a1e00' }
    if (st === 'OK')     return { color: '#4ade80', bg: '#0d2518' }
    return { color: '#556677', bg: 'transparent' }
  }

  return (
    <div style={col}>
      <div style={s.seccionHeader}>
        <h2 style={s.seccionTitulo}>📦 Catálogo & Stock</h2>
        <p style={s.seccionSub}>
          {modoAlertas
            ? 'Productos bajo punto de reorden — todos los sectores'
            : `${productos.length} productos${sectorNombre ? ` · stock en ${sectorNombre}` : ''}`}
        </p>
      </div>

      <div style={s.controlesBar}>
        <button
          style={{ ...s.btnToggle, ...(modoAlertas ? s.btnToggleRojo : {}) }}
          onClick={() => { setModoAlertas(v => !v); setBuscar(''); setSectorId('') }}
        >
          🔴 Alertas de stock
        </button>
        {!modoAlertas && (
          <select value={sectorId} onChange={e => setSectorId(e.target.value)} style={s.select}>
            <option value="">— Sin sector —</option>
            {sectores.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {!modoAlertas && (
          <input
            type="text" placeholder="Buscar producto..."
            value={buscar} onChange={e => setBuscar(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && cargar()}
            style={{ ...s.inputBuscar, flex: 1 }}
          />
        )}
        <button style={s.btnAmarillo} onClick={cargar} disabled={loading}>
          {loading ? 'Cargando...' : '↻ Cargar'}
        </button>
      </div>

      {error && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && <div style={s.cargando}>Cargando productos...</div>}

      {!loading && !error && productos.length > 0 && (<>
        <div style={s.tablaWrap}>
          <table style={s.tabla}>
            <thead>
              <tr>
                <th style={s.th}>Producto</th>
                <th style={s.th}>Condición</th>
                <th style={s.th}>Unid.</th>
                {modoAlertas && <th style={s.th}>Sector</th>}
                <th style={{ ...s.th, textAlign: 'right' }}>Stock</th>
                {(sectorId && !modoAlertas) && <th style={{ ...s.th, textAlign: 'right' }}>Reorden</th>}
                <th style={{ ...s.th, textAlign: 'center' }}>Estado</th>
                {(sectorId || modoAlertas) && <th style={s.th}>Último mov.</th>}
                <th style={{ ...s.th, textAlign: 'center' }}>Tango</th>
              </tr>
            </thead>
            <tbody>
              {paginados.map(p => {
                const sc = stockColor(p.stock_status)
                return (
                  <tr key={p.id}>
                    <td style={s.td}>
                      <span style={{ color: '#e2eaf4', fontWeight: 500 }}>{p.nombre}</span>
                      {p.sub_condition && <span style={s.chip}>{p.sub_condition}</span>}
                      <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                        {p.para_sucursal && <span style={s.flag}>suc</span>}
                        {p.cocina        && <span style={s.flag}>coc</span>}
                        {p.fabrica       && <span style={s.flag}>fab</span>}
                        {p.armado        && <span style={s.flag}>arm</span>}
                        {p.fracionable   && <span style={s.flag}>frac</span>}
                      </div>
                    </td>
                    <td style={{ ...s.td, color: '#8899aa', fontSize: 11 }}>{p.condition || '—'}</td>
                    <td style={{ ...s.td, color: '#8899aa', fontSize: 12 }}>{p.unidad}</td>
                    {modoAlertas && <td style={{ ...s.td, color: '#7dd3fc', fontSize: 12 }}>{p.sector_name}</td>}
                    <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: p.stock_qty !== null ? '#e2eaf4' : '#243550' }}>
                      {p.stock_qty !== null ? p.stock_qty : '—'}
                    </td>
                    {(sectorId && !modoAlertas) && (
                      <td style={{ ...s.td, textAlign: 'right', color: '#8899aa', fontSize: 12 }}>
                        {p.reorder_point !== null ? p.reorder_point : '—'}
                      </td>
                    )}
                    <td style={{ ...s.td, textAlign: 'center' }}>
                      {p.stock_status
                        ? <span style={{ background: sc.bg, color: sc.color, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{p.stock_status}</span>
                        : <span style={{ color: '#243550', fontSize: 10 }}>—</span>}
                    </td>
                    {(sectorId || modoAlertas) && (
                      <td style={{ ...s.td, fontSize: 10, color: '#556677' }}>
                        {p.last_updated ? tsAR(p.last_updated) : '—'}
                        {p.last_movement && <div style={{ color: '#445566', marginTop: 1 }}>{p.last_movement}</div>}
                      </td>
                    )}
                    <td style={{ ...s.td, textAlign: 'center', color: '#4a7fa5', fontSize: 11 }}>{p.codigo_tango || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalPags > 1 && (
          <div style={s.paginacion}>
            <button style={s.btnGris} disabled={pagina === 0} onClick={() => setPagina(v => v - 1)}>← Anterior</button>
            <span style={{ color: '#8899aa', fontSize: 12 }}>Pág. {pagina + 1} / {totalPags} · {productos.length} productos</span>
            <button style={s.btnGris} disabled={pagina >= totalPags - 1} onClick={() => setPagina(v => v + 1)}>Siguiente →</button>
          </div>
        )}
      </>)}

      {!loading && !error && productos.length === 0 && (
        <div style={s.cargando}>
          {modoAlertas ? 'No hay productos bajo punto de reorden.' : 'Hacé clic en "Cargar" para ver el catálogo.'}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO C — Estado en vivo
// ═══════════════════════════════════════════════════════════════════════════════
function SeccionEstado() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/estado-live')
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e) { setError(e.message) }
    finally     { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Auto-refresh cada 60 segundos
  useEffect(() => {
    const t = setInterval(cargar, 60_000)
    return () => clearInterval(t)
  }, [cargar])

  function semaforoColor(sector) {
    const pendientes = sector.items_pendientes ?? 0
    const listos     = sector.items_listos     ?? 0
    const horas      = sector.promedio_horas_espera ?? 0
    if (pendientes === 0) return { border: '#22c55e', bg: '#0d2518', dot: '#22c55e', label: 'Sin pendientes' }
    if (horas > 4)        return { border: '#ef4444', bg: '#3b0a0a', dot: '#ef4444', label: 'Demorado' }
    if (listos > 0)       return { border: '#f59e0b', bg: '#2a1e00', dot: '#f59e0b', label: 'En progreso' }
    return               { border: '#f59e0b', bg: '#2a1e00', dot: '#f59e0b', label: 'Pendiente' }
  }

  return (
    <div style={col}>
      <div style={{ ...s.seccionHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={s.seccionTitulo}>🟢 Estado en vivo</h2>
          <p style={s.seccionSub}>Se actualiza automáticamente cada 60 segundos</p>
        </div>
        <button style={s.btnGris} onClick={cargar} disabled={loading}>↻ Actualizar</button>
      </div>

      {error   && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && !data && <div style={s.cargando}>Cargando estado...</div>}

      {data && (<>

        {/* Semáforos por sector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {data.workload.map(sec => {
            const c = semaforoColor(sec)
            return (
              <div key={sec.sector} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.dot, flexShrink: 0, boxShadow: `0 0 6px ${c.dot}` }} />
                  <span style={{ color: 'white', fontWeight: 700, fontSize: 13 }}>{sec.sector}</span>
                  <span style={{ marginLeft: 'auto', color: c.dot, fontSize: 10, fontWeight: 600 }}>{c.label}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <MetricaMini label="Items pend." valor={sec.items_pendientes ?? 0} color={sec.items_pendientes > 0 ? '#fca5a5' : '#4ade80'} />
                  <MetricaMini label="Listos"      valor={sec.items_listos     ?? 0} color="#4ade80" />
                  <MetricaMini label="En prod."    valor={sec.ordenes_en_produccion ?? 0} color="#7dd3fc" />
                  <MetricaMini label="Hs espera"   valor={sec.promedio_horas_espera != null ? `${sec.promedio_horas_espera}h` : '—'} color={sec.promedio_horas_espera > 4 ? '#fca5a5' : '#8899aa'} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Pedidos activos */}
        {data.pedidosActivos.length > 0 && (
          <div>
            <p style={s.subSeccion}>Pedidos activos de sucursales</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Nro. pedido</th>
                    <th style={s.th}>Sucursal</th>
                    <th style={s.th}>Entrega</th>
                    <th style={s.th}>Estado</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Items</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Confirmados</th>
                    <th style={s.th}>Sectores</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pedidosActivos.map(p => {
                    const sc = STATUS_COLOR[p.status] || '#8899aa'
                    return (
                      <tr key={p.id}>
                        <td style={{ ...s.td, color: '#F4C430', fontFamily: 'monospace', fontSize: 12 }}>{p.order_number}</td>
                        <td style={s.td}>{p.branch_name || p.branch_code}</td>
                        <td style={{ ...s.td, fontSize: 12 }}>{fechaAR(p.requested_delivery_date)}</td>
                        <td style={s.td}>
                          <span style={{ color: sc, background: sc + '22', border: `1px solid ${sc}55`, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                            {STATUS_LABEL[p.status] || p.status}
                          </span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'center' }}>{p.total_items}</td>
                        <td style={{ ...s.td, textAlign: 'center', color: '#4ade80' }}>{p.confirmed_items}</td>
                        <td style={{ ...s.td, fontSize: 11, color: '#8899aa' }}>{p.sectors_involved || '—'}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: p.hours_since_created > 8 ? '#fca5a5' : '#8899aa' }}>
                          {p.hours_since_created != null ? `${p.hours_since_created}h` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actividad reciente */}
        {data.actividad.length > 0 && (
          <div>
            <p style={s.subSeccion}>Actividad reciente (últimas 8 hs)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.actividad.map((ev, i) => {
                const cPrev = STATUS_COLOR[ev.previous_status] || '#556677'
                const cNew  = STATUS_COLOR[ev.new_status]      || '#8899aa'
                const meta  = ev.metadata || {}
                const label = meta.order_number || meta.branch_code || ev.entity_type
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: '#0d1a2a', borderRadius: 6, fontSize: 12 }}>
                    <span style={{ color: '#4a7fa5', flexShrink: 0, fontSize: 11 }}>{tsAR(ev.changed_at)}</span>
                    <span style={{ color: '#F4C430', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>{label}</span>
                    <span style={{ color: cPrev, flexShrink: 0 }}>{STATUS_LABEL[ev.previous_status] || ev.previous_status || '·'}</span>
                    <span style={{ color: '#4a7fa5', flexShrink: 0 }}>→</span>
                    <span style={{ color: cNew, fontWeight: 600, flexShrink: 0 }}>{STATUS_LABEL[ev.new_status] || ev.new_status}</span>
                    {meta.branch_name && <span style={{ color: '#556677', marginLeft: 'auto', flexShrink: 0 }}>{meta.branch_name}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </>)}
    </div>
  )
}

function MetricaMini({ label, valor, color }) {
  return (
    <div style={{ background: '#0f1c2e', borderRadius: 6, padding: '5px 8px' }}>
      <div style={{ color: '#4a7fa5', fontSize: 9, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color, fontWeight: 700, fontSize: 18, marginTop: 1 }}>{valor}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO D — Pedidos
// ═══════════════════════════════════════════════════════════════════════════════
function SeccionPedidos() {
  const [tab,        setTab]        = useState('sucursal')
  const [fecha,      setFecha]      = useState(hoyAR())
  const [estado,     setEstado]     = useState('')
  const [branchCode, setBranchCode] = useState('')
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const [pagina,     setPagina]     = useState(0)
  const [detalle,    setDetalle]    = useState(null)   // { id, entity_type, data }
  const [loadingDet, setLoadingDet] = useState(false)

  const SUCURSALES = ['LMA','RDT','KND','POL','KM3','KM8','CLO']
  const ESTADOS    = Object.keys(STATUS_LABEL)

  const cargar = useCallback(async (pag = 0) => {
    setLoading(true); setError(null); setDetalle(null); setPagina(pag)
    try {
      const p = new URLSearchParams({ tipo: tab, pagina: pag })
      if (fecha)      p.set('fecha', fecha)
      if (estado)     p.set('estado', estado)
      if (tab === 'sucursal' && branchCode) p.set('branch_code', branchCode)
      const res = await fetch(`/api/admin/pedidos?${p}`)
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e) { setError(e.message) }
    finally     { setLoading(false) }
  }, [tab, fecha, estado, branchCode])

  useEffect(() => { cargar(0) }, [tab]) // eslint-disable-line

  async function verDetalle(id, entityType) {
    if (detalle?.id === id) { setDetalle(null); return }
    setLoadingDet(true); setDetalle({ id, entity_type: entityType, data: null })
    try {
      const res = await fetch(`/api/admin/pedidos/${id}?entity_type=${entityType}`)
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setDetalle({ id, entity_type: entityType, data: d })
    } catch (e) { setDetalle({ id, entity_type: entityType, data: null, error: e.message }) }
    finally     { setLoadingDet(false) }
  }

  return (
    <div style={col}>
      <h2 style={s.seccionTitulo}>📋 Pedidos — Solo lectura</h2>

      {/* Tabs */}
      <div style={s.tabs}>
        {[['sucursal','🏪 Pedidos de sucursal'],['interna','⚙️ Órdenes internas']].map(([id, label]) => (
          <button key={id} style={{ ...s.tab, ...(tab === id ? s.tabActivo : {}) }} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={s.controlesBar}>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={s.inputFecha} />
        <select value={estado} onChange={e => setEstado(e.target.value)} style={s.select}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{STATUS_LABEL[e]}</option>)}
        </select>
        {tab === 'sucursal' && (
          <select value={branchCode} onChange={e => setBranchCode(e.target.value)} style={s.select}>
            <option value="">Todas las sucursales</option>
            {SUCURSALES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button style={s.btnAmarillo} onClick={() => cargar(0)} disabled={loading}>
          {loading ? 'Cargando...' : '↻ Buscar'}
        </button>
        {fecha && <button style={s.btnGris} onClick={() => setFecha('')}>✕ Sin fecha</button>}
      </div>

      {error   && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && <div style={s.cargando}>Cargando pedidos...</div>}

      {!loading && data && (<>
        <p style={{ color: '#8899aa', fontSize: 12, margin: '4px 0' }}>
          {data.total} resultado{data.total !== 1 ? 's' : ''}
          {data.total > data.por_pagina && ` · página ${data.pagina + 1}`}
        </p>

        <div style={s.tablaWrap}>
          <table style={s.tabla}>
            <thead>
              <tr>
                <th style={s.th}>Nro. pedido</th>
                {tab === 'sucursal' ? <>
                  <th style={s.th}>Sucursal</th>
                  <th style={s.th}>Entrega</th>
                </> : <>
                  <th style={s.th}>Desde</th>
                  <th style={s.th}>Hacia</th>
                  <th style={s.th}>Tipo</th>
                </>}
                <th style={s.th}>Estado</th>
                <th style={{ ...s.th, textAlign: 'center' }}>Items</th>
                <th style={s.th}>Creado</th>
                <th style={{ ...s.th, textAlign: 'center' }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#556677', padding: '2rem' }}>Sin resultados</td></tr>
              ) : data.rows.map(row => {
                const sc        = STATUS_COLOR[row.status] || '#8899aa'
                const entityType = tab === 'sucursal' ? 'branch_order' : 'internal_order'
                const abierto   = detalle?.id === row.id
                return (<>
                  <tr key={row.id} style={{ background: abierto ? '#0d1a2a' : 'transparent', cursor: 'pointer' }}
                    onClick={() => verDetalle(row.id, entityType)}>
                    <td style={{ ...s.td, color: '#F4C430', fontFamily: 'monospace', fontSize: 12 }}>{row.order_number}</td>
                    {tab === 'sucursal' ? <>
                      <td style={s.td}>{row.branch_name || row.branch_code}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{fechaAR(row.requested_delivery_date)}</td>
                    </> : <>
                      <td style={{ ...s.td, fontSize: 12 }}>{row.from_sector?.name || '—'}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{row.to_sector?.name || '—'}</td>
                      <td style={{ ...s.td, fontSize: 11, color: '#8899aa' }}>{row.order_type}</td>
                    </>}
                    <td style={s.td}>
                      <span style={{ color: sc, background: sc + '22', border: `1px solid ${sc}55`, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                    </td>
                    <td style={{ ...s.td, textAlign: 'center' }}>{row.total_items}</td>
                    <td style={{ ...s.td, fontSize: 11, color: '#8899aa' }}>{tsAR(row.created_at)}</td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#4a7fa5', fontSize: 13 }}>{abierto ? '▲' : '▼'}</td>
                  </tr>

                  {/* Fila de detalle inline */}
                  {abierto && (
                    <tr key={row.id + '-det'}>
                      <td colSpan={8} style={{ padding: 0, borderBottom: '2px solid #1e3050' }}>
                        <FilaDetalle detalle={detalle} loading={loadingDet} />
                      </td>
                    </tr>
                  )}
                </>)
              })}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {data.total > data.por_pagina && (
          <div style={s.paginacion}>
            <button style={s.btnGris} disabled={pagina === 0} onClick={() => cargar(pagina - 1)}>← Anterior</button>
            <span style={{ color: '#8899aa', fontSize: 12 }}>Pág. {pagina + 1} · {data.total} resultados</span>
            <button style={s.btnGris} disabled={(pagina + 1) * data.por_pagina >= data.total} onClick={() => cargar(pagina + 1)}>Siguiente →</button>
          </div>
        )}
      </>)}
    </div>
  )
}

function FilaDetalle({ detalle, loading }) {
  if (loading || !detalle.data) {
    return (
      <div style={{ padding: '16px 24px', color: '#4a7fa5', fontSize: 13 }}>
        {detalle.error ? `⚠ ${detalle.error}` : 'Cargando detalle...'}
      </div>
    )
  }
  const { pedido, historia } = detalle.data
  return (
    <div style={{ padding: '16px 24px', background: '#0a1520', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

      {/* Items del pedido */}
      <div>
        <p style={s.subSeccion}>Items ({pedido.items.length})</p>
        <table style={{ ...s.tabla, fontSize: 12 }}>
          <thead>
            <tr>
              <th style={s.th}>Producto</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Pedido</th>
              <th style={{ ...s.th, textAlign: 'right' }}>{pedido.items[0]?.producido !== undefined ? 'Producido' : 'Confirmado'}</th>
              <th style={s.th}>Estado</th>
              {pedido.items[0]?.sector && <th style={s.th}>Sector</th>}
            </tr>
          </thead>
          <tbody>
            {pedido.items.map(it => {
              const sc = STATUS_COLOR[it.estado] || '#8899aa'
              const qty = it.producido ?? it.confirmado
              return (
                <tr key={it.id}>
                  <td style={s.td}>{it.producto}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{it.pedido} {it.unidad}</td>
                  <td style={{ ...s.td, textAlign: 'right', color: '#4ade80' }}>{qty != null ? `${qty} ${it.unidad}` : '—'}</td>
                  <td style={s.td}>
                    <span style={{ color: sc, fontSize: 10, fontWeight: 600 }}>{STATUS_LABEL[it.estado] || it.estado}</span>
                  </td>
                  {it.sector && <td style={{ ...s.td, color: '#8899aa', fontSize: 11 }}>{it.sector}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Línea de tiempo (audit) */}
      <div>
        <p style={s.subSeccion}>Historial de estados</p>
        {historia.length === 0 ? (
          <p style={{ color: '#556677', fontSize: 12 }}>Sin registros en audit (los cambios de estado se loguean vía trigger).</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historia.map((ev, i) => {
              const cNew = STATUS_COLOR[ev.new_status] || '#8899aa'
              return (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cNew, marginTop: 4 }} />
                    {i < historia.length - 1 && <span style={{ width: 1, height: 20, background: '#1e3050' }} />}
                  </div>
                  <div>
                    <span style={{ color: cNew, fontWeight: 600, fontSize: 12 }}>{STATUS_LABEL[ev.new_status] || ev.new_status}</span>
                    {ev.previous_status && <span style={{ color: '#4a7fa5', fontSize: 11, marginLeft: 6 }}>← {STATUS_LABEL[ev.previous_status] || ev.previous_status}</span>}
                    <div style={{ color: '#556677', fontSize: 10, marginTop: 2 }}>{tsAR(ev.changed_at)}{ev.changed_by ? ` · ${ev.changed_by}` : ''}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO E — Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
function SeccionDashboard() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/dashboard')
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e) { setError(e.message) }
    finally     { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Agrupar producción por día para la tabla
  const diasUnicos = data
    ? [...new Set(data.produccion.map(r => r.fecha))].sort().reverse()
    : []

  return (
    <div style={col}>
      <div style={{ ...s.seccionHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={s.seccionTitulo}>📊 Dashboard</h2>
          {data?.generado_at && <p style={s.seccionSub}>Datos al {tsAR(data.generado_at)}</p>}
        </div>
        <button style={s.btnGris} onClick={cargar} disabled={loading}>↻ Actualizar</button>
      </div>

      {error   && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && !data && <div style={s.cargando}>Cargando dashboard...</div>}

      {data && (<>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {data.kpis.map(k => (
            <div key={k.metrica} style={{ background: '#162236', border: '1px solid #243550', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#4a7fa5', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{k.metrica}</div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: 28 }}>{k.valor}</div>
            </div>
          ))}
        </div>

        {/* Producción últimos 30 días */}
        {data.produccion.length > 0 && (
          <div>
            <p style={s.subSeccion}>Producción últimos 30 días (órdenes completadas)</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Fecha</th>
                    <th style={s.th}>Sector</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Órdenes</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Items prod.</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Cantidad total</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Min. prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.produccion.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, fontSize: 12, color: '#F4C430', fontFamily: 'monospace' }}>{fechaAR(r.fecha)}</td>
                      <td style={s.td}>{r.sector}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{r.ordenes_completadas}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{r.items_producidos}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#7dd3fc' }}>{r.cantidad_total != null ? Number(r.cantidad_total).toFixed(1) : '—'}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#8899aa', fontSize: 12 }}>{r.minutos_promedio_produccion != null ? `${Number(r.minutos_promedio_produccion).toFixed(0)} min` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Remitos recientes */}
        {data.remitos.length > 0 && (
          <div>
            <p style={s.subSeccion}>Remitos — últimos 7 días</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Remito</th>
                    <th style={s.th}>Tipo</th>
                    <th style={s.th}>Sucursal</th>
                    <th style={s.th}>Estado</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Items</th>
                    <th style={s.th}>Despachado</th>
                    <th style={s.th}>Entregado</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Hs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.remitos.map((r, i) => {
                    const sc = r.status === 'DELIVERED' ? '#4ade80' : r.status === 'IN_TRANSIT' ? '#38bdf8' : '#8899aa'
                    return (
                      <tr key={i}>
                        <td style={{ ...s.td, color: '#F4C430', fontFamily: 'monospace', fontSize: 11 }}>{r.shipment_number}</td>
                        <td style={{ ...s.td, fontSize: 11, color: '#8899aa' }}>{r.shipment_type}</td>
                        <td style={s.td}>{r.branch_name || r.branch_code}</td>
                        <td style={s.td}>
                          <span style={{ color: sc, fontSize: 11, fontWeight: 600 }}>{r.status}</span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'center' }}>{r.total_items}</td>
                        <td style={{ ...s.td, fontSize: 11, color: '#8899aa' }}>{tsAR(r.dispatched_at)}</td>
                        <td style={{ ...s.td, fontSize: 11, color: '#4ade80' }}>{r.delivered_at ? tsAR(r.delivered_at) : '—'}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 11, color: '#8899aa' }}>{r.delivery_hours != null ? `${Number(r.delivery_hours).toFixed(1)}h` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Movimientos de stock recientes */}
        {data.stockMovimientos.length > 0 && (
          <div>
            <p style={s.subSeccion}>Movimientos de stock — últimas 24 hs</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Hora</th>
                    <th style={s.th}>Sector</th>
                    <th style={s.th}>Producto</th>
                    <th style={s.th}>Tipo</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Cant.</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Antes</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Después</th>
                    <th style={s.th}>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockMovimientos.map((m, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, fontSize: 11, color: '#4a7fa5', fontFamily: 'monospace' }}>{tsAR(m.created_at)}</td>
                      <td style={{ ...s.td, fontSize: 12 }}>{m.sector}</td>
                      <td style={s.td}>{m.producto}</td>
                      <td style={{ ...s.td, fontSize: 11, color: '#a78bfa' }}>{m.tipo_movimiento}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: '#7dd3fc' }}>{m.cantidad} {m.unidad}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#556677', fontSize: 12 }}>{m.stock_antes}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#4ade80', fontSize: 12 }}>{m.stock_despues}</td>
                      <td style={{ ...s.td, fontSize: 11, color: '#556677' }}>{m.usuario || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {data.produccion.length === 0 && data.remitos.length === 0 && data.stockMovimientos.length === 0 && (
          <div style={s.cargando}>Sin datos de producción ni movimientos recientes aún.</div>
        )}

      </>)}
    </div>
  )
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const col = { display: 'flex', flexDirection: 'column', gap: 16 }

const s = {
  page:          { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0 },
  logoBlanco:    { color: 'white', fontSize: '1rem', fontWeight: 700, letterSpacing: '.06em' },
  logoAmarillo:  { color: '#F4C430', fontSize: '1rem', fontWeight: 700, letterSpacing: '.06em' },
  headerSub:     { color: '#4a7fa5', fontSize: 12, marginLeft: 4 },
  userLabel:     { color: '#8899aa', fontSize: 13 },
  btnSalir:      { background: 'none', border: '1px solid #243550', borderRadius: 5, color: '#8899aa', fontSize: 12, padding: '4px 10px', cursor: 'pointer' },

  shell:         { display: 'flex', flex: 1, minHeight: 0 },
  sidebar:       { width: 210, flexShrink: 0, background: '#0d1a2a', borderRight: '1px solid #1e3050', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  sidebarTitulo: { color: '#4a7fa5', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 8, margin: '0 0 8px' },
  navBtn:        { background: 'none', border: 'none', borderRadius: 7, color: '#7a9bb8', fontSize: 13, fontWeight: 500, padding: '9px 12px', cursor: 'pointer', textAlign: 'left' },
  navBtnActivo:  { background: '#162236', color: '#F4C430', fontWeight: 700, border: '1px solid #243550' },

  main:          { flex: 1, padding: '1.5rem 2rem', overflowY: 'auto' },

  seccionHeader: { marginBottom: 4 },
  seccionTitulo: { color: 'white', fontSize: '1.2rem', fontWeight: 700, margin: 0 },
  seccionSub:    { color: '#8899aa', fontSize: 12, marginTop: 4 },
  subSeccion:    { color: '#4a7fa5', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', margin: '4px 0 6px' },

  controlesBar:  { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#0d1a2a', border: '1px solid #1e3050', borderRadius: 8, padding: '10px 14px' },
  select:        { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', cursor: 'pointer', outline: 'none' },
  inputBuscar:   { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', outline: 'none', minWidth: 160 },
  inputFecha:    { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', outline: 'none', cursor: 'pointer' },
  btnToggle:     { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#8899aa', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' },
  btnToggleRojo: { background: '#3b0a0a', border: '1px solid #ef4444', color: '#fca5a5' },
  btnAmarillo:   { background: '#162236', border: '1px solid #F4C430', borderRadius: 6, color: '#F4C430', fontSize: 12, fontWeight: 700, padding: '6px 16px', cursor: 'pointer' },
  btnGris:       { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#7a9bb8', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' },

  tabs:          { display: 'flex', gap: 4, borderBottom: '1px solid #243550' },
  tab:           { background: 'none', border: 'none', color: '#8899aa', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:     { color: '#F4C430', borderBottom: '2px solid #F4C430' },

  tablaWrap:     { overflow: 'auto', border: '1px solid #1e3050', borderRadius: 8 },
  tabla:         { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:            { background: '#0d1a2a', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #1e3050', position: 'sticky', top: 0, whiteSpace: 'nowrap' },
  td:            { color: '#c8d8e8', padding: '7px 12px', borderBottom: '1px solid #162236', verticalAlign: 'middle' },

  chip:          { display: 'inline-block', background: '#1a2a3a', color: '#7dd3fc', border: '1px solid #243550', borderRadius: 3, fontSize: 9, fontWeight: 600, padding: '0 5px', marginLeft: 6, verticalAlign: 'middle' },
  flag:          { background: '#0f1c2e', color: '#4a7fa5', border: '1px solid #1e3050', borderRadius: 3, fontSize: 9, padding: '0 4px', letterSpacing: '.03em' },

  paginacion:    { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '12px 0' },
  cargando:      { padding: '3rem', textAlign: 'center', color: '#8899aa' },
  errorBox:      { background: '#3b0a0a', border: '1px solid #ef4444', borderRadius: 8, color: '#fca5a5', padding: '12px 16px', fontSize: 13 },
}
