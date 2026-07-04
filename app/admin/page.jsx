'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'

// TODO: restringir a rol ADMIN cuando exista tabla de usuarios

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    ? new Date(iso + 'T12:00:00') : new Date(iso)
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

// ── Constantes ────────────────────────────────────────────────────────────────
const VALID_UNITS   = ['KG', 'LITRO', 'UNIDAD', 'GRAMO', 'ML', 'DOCENA']
const CONDITIONS    = ['INSUMO', 'MATERIA PRIMA', 'PRODUCIDO', 'REVENTA']
const SUB_CONDITIONS = [
  'aceites','aceituna','aderezo','aguas','almacen','carnes','cerveza',
  'condimento','consumibles','copetin','elementos de trabajo','embutidos',
  'enlatado','envases','etiqueta','fabrica','fraccionados','freir',
  'gaseosa','grasas','harinas','hojaldre','horno','jugos','lacteos',
  'legumbres','limpieza','pizzeria','pollo','postres','receta',
  'sandwiches','supercongelados','vacio','verduleria','vinos',
]
const FIELD_LABELS = {
  official_name:          'Nombre',
  base_unit:              'Unidad',
  condition:              'Condición',
  sub_condition:          'Sub-categoría',
  codigo_tango:           'Código Tango',
  is_for_branches:        'Para sucursales',
  is_produced_in_kitchen: 'Cocina',
  is_produced_in_fabrica: 'Fábrica',
  is_produced_in_armado:  'Armado',
  is_fractionable:        'Fraccionable',
  is_active:              'Activo',
}
const STATUS_LABEL = {
  DRAFT:'Borrador', PENDING_CONFIRMATION:'Pendiente', CONFIRMED_PARTIAL:'Conf. parcial',
  IN_PRODUCTION:'En producción', READY_FOR_PICKUP:'Listo', DISPATCHED:'Despachado',
  DELIVERED:'Entregado', CANCELLED:'Cancelado',
}
const STATUS_COLOR = {
  DRAFT:'#4a7fa5', PENDING_CONFIRMATION:'#f59e0b', CONFIRMED_PARTIAL:'#a78bfa',
  IN_PRODUCTION:'#38bdf8', READY_FOR_PICKUP:'#4ade80', DISPATCHED:'#34d399',
  DELIVERED:'#22c55e', CANCELLED:'#6b7280',
}
const NAV_ITEMS = [
  { id:'catalogo', label:'📦 Catálogo & Stock' },
  { id:'estado',   label:'🟢 Estado en vivo'  },
  { id:'pedidos',  label:'📋 Pedidos'          },
  { id:'dashboard',label:'📊 Dashboard'        },
]

// ── Shell ─────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { data: session, status } = useSession()
  const router  = useRouter()
  const [seccion, setSeccion] = useState('catalogo')

  // Estado de pendientes — compartido entre menú, badges del catálogo y modal
  const [pendingCount,      setPendingCount]      = useState(0)
  const [pendingProductIds, setPendingProductIds] = useState(new Set())

  // Estado de modales
  const [modalCrear,   setModalCrear]   = useState(false)
  const [modalEditar,  setModalEditar]  = useState(false)
  const [modalAplicar, setModalAplicar] = useState(false)

  const refreshPendingData = useCallback(async () => {
    try {
      const [countRes, listRes] = await Promise.all([
        fetch('/api/admin/articulos/pendientes/count'),
        fetch('/api/admin/articulos/pendientes'),
      ])
      const { count } = await countRes.json()
      const list = await listRes.json()
      setPendingCount(count || 0)
      setPendingProductIds(new Set((Array.isArray(list) ? list : []).map(p => p.product_id)))
    } catch {}
  }, [])

  useEffect(() => { if (status === 'unauthenticated') router.push('/') }, [status, router])
  useEffect(() => { refreshPendingData() }, [refreshPendingData])

  if (status === 'loading') {
    return <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  }

  function onModalSuccess() {
    setModalCrear(false); setModalEditar(false); setModalAplicar(false)
    refreshPendingData()
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoAmarillo}>ADMIN</span>
          <span style={s.headerSub}>Base de Operaciones</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={s.userLabel}>{session?.user?.sector}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* Barra de acciones de carga */}
      <BarraCarga
        pendingCount={pendingCount}
        onAbrirMenu={refreshPendingData}
        onAgregar={() => setModalCrear(true)}
        onModificar={() => setModalEditar(true)}
        onAplicar={() => setModalAplicar(true)}
      />

      <div style={s.shell}>
        <nav style={s.sidebar}>
          <p style={s.sidebarTitulo}>Módulos</p>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              style={{ ...s.navBtn, ...(seccion === item.id ? s.navBtnActivo : {}) }}
              onClick={() => setSeccion(item.id)}
            >{item.label}</button>
          ))}
        </nav>
        <main style={s.main}>
          {seccion === 'catalogo'  && (
            <SeccionCatalogo
              pendingProductIds={pendingProductIds}
              onRefreshPending={refreshPendingData}
            />
          )}
          {seccion === 'estado'    && <SeccionEstado />}
          {seccion === 'pedidos'   && <SeccionPedidos />}
          {seccion === 'dashboard' && <SeccionDashboard />}
        </main>
      </div>

      {/* Modales */}
      {modalCrear   && <ModalCrearArticulo   onClose={() => setModalCrear(false)}   onSuccess={onModalSuccess} />}
      {modalEditar  && <ModalEditarArticulo  onClose={() => setModalEditar(false)}  onSuccess={onModalSuccess} />}
      {modalAplicar && <ModalAplicarPendientes onClose={() => setModalAplicar(false)} onSuccess={onModalSuccess} />}
    </div>
  )
}

// ── Barra de carga ────────────────────────────────────────────────────────────
function BarraCarga({ pendingCount, onAbrirMenu, onAgregar, onModificar, onAplicar }) {
  const [abierto, setAbierto] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function abrir() { onAbrirMenu(); setAbierto(v => !v) }

  return (
    <div style={s.barra}>
      <div style={{ position: 'relative' }} ref={ref}>
        <button style={s.btnMenu} onClick={abrir}>
          Carga productos {abierto ? '▲' : '▾'}
          {pendingCount > 0 && (
            <span style={s.badgePending}>{pendingCount}</span>
          )}
        </button>
        {abierto && (
          <div style={s.dropdown}>
            <button style={s.dropItem} onClick={() => { setAbierto(false); onAgregar() }}>
              ➕ Agregar artículo a DB
            </button>
            <button style={s.dropItem} onClick={() => { setAbierto(false); onModificar() }}>
              ✏️ Modificar artículo existente
            </button>
            <div style={{ borderTop: '1px solid #1e3050', margin: '4px 0' }} />
            {pendingCount === 0 ? (
              <button style={{ ...s.dropItem, color: '#4a7fa5', cursor: 'not-allowed' }} disabled>
                ⏳ Sin cambios pendientes
              </button>
            ) : (
              <button style={{ ...s.dropItem, color: '#4ade80', fontWeight: 700 }} onClick={() => { setAbierto(false); onAplicar() }}>
                ✅ Aplicar cambios pendientes ({pendingCount})
              </button>
            )}
          </div>
        )}
      </div>
      {pendingCount > 0 && (
        <span style={{ color: '#fde68a', fontSize: 12 }}>
          {pendingCount} cambio{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''} sin aplicar
        </span>
      )}
    </div>
  )
}

// ── Campos compartidos de formulario de artículo ──────────────────────────────
function CamposProducto({ values, onChange, modoEdicion = false }) {
  return (
    <div style={col}>
      <div>
        <label style={s.label}>Nombre oficial *</label>
        <input style={s.input} value={values.official_name || ''} onChange={e => onChange('official_name', e.target.value)} placeholder="Nombre del artículo" autoFocus />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Unidad base *</label>
          <select style={s.inputSel} value={values.base_unit || ''} onChange={e => onChange('base_unit', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {VALID_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Código Tango</label>
          <input style={s.input} type="number" step="any" value={values.codigo_tango ?? ''} onChange={e => onChange('codigo_tango', e.target.value)} placeholder="Opcional" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Condición</label>
          <select style={s.inputSel} value={values.condition || ''} onChange={e => onChange('condition', e.target.value)}>
            <option value="">— Ninguna —</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label style={s.label}>Sub-categoría</label>
          <input style={s.input} list="sub-conds-list" value={values.sub_condition || ''} onChange={e => onChange('sub_condition', e.target.value)} placeholder="Escribir o seleccionar..." />
          <datalist id="sub-conds-list">
            {SUB_CONDITIONS.map(sc => <option key={sc} value={sc} />)}
          </datalist>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={s.label}>Descripción</label>
          <textarea style={{ ...s.input, minHeight: 54, resize: 'vertical' }} value={values.description || ''} onChange={e => onChange('description', e.target.value)} />
        </div>
        <div>
          <label style={s.label}>Código interno</label>
          <input style={s.input} value={values.internal_code || ''} onChange={e => onChange('internal_code', e.target.value)} placeholder="Opcional" />
        </div>
      </div>
      <div>
        <p style={{ ...s.label, marginBottom: 8 }}>Flags de producción / distribución</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            ['is_for_branches',        'Para sucursales'],
            ['is_produced_in_kitchen', 'Cocina'],
            ['is_produced_in_fabrica', 'Fábrica'],
            ['is_produced_in_armado',  'Armado'],
            ['is_fractionable',        'Fraccionable'],
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c8d8e8', fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={!!values[key]} onChange={e => onChange(key, e.target.checked)} style={{ accentColor: '#F4C430', width: 14, height: 14 }} />
              {label}
            </label>
          ))}
          {modoEdicion && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fca5a5', fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={!!values.is_active} onChange={e => onChange('is_active', e.target.checked)} style={{ accentColor: '#ef4444', width: 14, height: 14 }} />
              Activo (desmarcar = desactivar)
            </label>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: Crear artículo ─────────────────────────────────────────────────────
function ModalCrearArticulo({ onClose, onSuccess }) {
  const [values, setValues] = useState({
    official_name: '', base_unit: 'KG', condition: '', sub_condition: '',
    codigo_tango: '', description: '', internal_code: '',
    is_for_branches: false, is_produced_in_kitchen: false, is_produced_in_fabrica: false,
    is_produced_in_armado: false, is_fractionable: false,
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [exito,   setExito]   = useState(null)

  function handleChange(key, val) { setValues(v => ({ ...v, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null); setExito(null)
    try {
      const res = await fetch('/api/admin/articulos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error); return }
      setExito(`Artículo "${d.official_name}" creado correctamente.`)
      setTimeout(() => onSuccess(), 1200)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <div style={s.modalHeader}>
          <h3 style={s.modalTitulo}>➕ Agregar artículo</h3>
          <button style={s.btnCerrar} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={col}>
          <CamposProducto values={values} onChange={handleChange} />
          {error && <div style={s.errorBox}>⚠ {error}</div>}
          {exito && <div style={s.okBox}>✓ {exito}</div>}
          <div style={s.modalFooter}>
            <button type="button" style={s.btnGris} onClick={onClose}>Cancelar</button>
            <button type="submit" style={s.btnAmarillo} disabled={loading || !!exito}>
              {loading ? 'Guardando...' : '✓ Crear artículo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Editar artículo (encola pending) ───────────────────────────────────
function ModalEditarArticulo({ onClose, onSuccess }) {
  const [buscar,      setBuscar]      = useState('')
  const [resultados,  setResultados]  = useState([])
  const [buscando,    setBuscando]    = useState(false)
  const [seleccionado, setSeleccionado] = useState(null)
  const [values,      setValues]      = useState({})
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [exito,       setExito]       = useState(null)

  async function buscarProductos() {
    if (buscar.length < 2) return
    setBuscando(true); setResultados([])
    try {
      const res = await fetch(`/api/admin/articulos?buscar=${encodeURIComponent(buscar)}`)
      const d   = await res.json()
      setResultados(Array.isArray(d) ? d : [])
    } catch {}
    finally { setBuscando(false) }
  }

  function seleccionar(prod) {
    setSeleccionado(prod)
    setValues({
      official_name:          prod.official_name          || '',
      base_unit:              prod.base_unit              || 'KG',
      condition:              prod.condition              || '',
      sub_condition:          prod.sub_condition          || '',
      codigo_tango:           prod.codigo_tango           ?? '',
      description:            prod.description            || '',
      internal_code:          prod.internal_code          || '',
      is_for_branches:        !!prod.is_for_branches,
      is_produced_in_kitchen: !!prod.is_produced_in_kitchen,
      is_produced_in_fabrica: !!prod.is_produced_in_fabrica,
      is_produced_in_armado:  !!prod.is_produced_in_armado,
      is_fractionable:        !!prod.is_fractionable,
      is_active:              prod.is_active ?? true,
    })
    setError(null); setExito(null)
  }

  function handleChange(key, val) { setValues(v => ({ ...v, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null); setExito(null)
    try {
      const res = await fetch(`/api/admin/articulos/${seleccionado.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error); return }
      setExito('Cambio encolado. Se aplicará cuando uses "Aplicar cambios pendientes".')
      onSuccess()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...s.modal, maxWidth: 640 }}>
        <div style={s.modalHeader}>
          <h3 style={s.modalTitulo}>✏️ Modificar artículo</h3>
          <button style={s.btnCerrar} onClick={onClose}>✕</button>
        </div>

        {/* Fase 1: buscar */}
        {!seleccionado && (
          <div style={col}>
            <p style={{ color: '#8899aa', fontSize: 12, margin: 0 }}>Buscá el artículo que querés modificar:</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...s.input, flex: 1 }}
                value={buscar}
                onChange={e => setBuscar(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarProductos())}
                placeholder="Nombre del artículo (mín. 2 caracteres)..."
                autoFocus
              />
              <button type="button" style={s.btnAmarillo} onClick={buscarProductos} disabled={buscando || buscar.length < 2}>
                {buscando ? '…' : 'Buscar'}
              </button>
            </div>
            {resultados.length > 0 && (
              <div style={{ border: '1px solid #243550', borderRadius: 8, overflow: 'auto', maxHeight: 300 }}>
                {resultados.map(p => (
                  <button key={p.id} type="button"
                    style={{ ...s.dropItem, display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}
                    onClick={() => seleccionar(p)}
                  >
                    <span style={{ color: '#c8d8e8', flex: 1, textAlign: 'left' }}>{p.official_name}</span>
                    <span style={{ color: '#4a7fa5', fontSize: 11 }}>{p.base_unit}</span>
                    {!p.is_active && <span style={{ color: '#fca5a5', fontSize: 10, fontWeight: 700 }}>INACTIVO</span>}
                  </button>
                ))}
              </div>
            )}
            {!buscando && buscar.length >= 2 && resultados.length === 0 && (
              <p style={{ color: '#4a7fa5', fontSize: 12 }}>Sin resultados para "{buscar}".</p>
            )}
          </div>
        )}

        {/* Fase 2: editar */}
        {seleccionado && (
          <form onSubmit={handleSubmit} style={col}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ color: '#7dd3fc', fontSize: 12, margin: 0 }}>
                Editando: <strong style={{ color: '#F4C430' }}>{seleccionado.official_name}</strong>
              </p>
              <button type="button" style={{ ...s.btnGris, fontSize: 11, padding: '3px 8px' }}
                onClick={() => { setSeleccionado(null); setExito(null); setError(null) }}>
                ← Volver a buscar
              </button>
            </div>
            <CamposProducto values={values} onChange={handleChange} modoEdicion />
            {error && <div style={s.errorBox}>⚠ {error}</div>}
            {exito && <div style={s.okBox}>⏳ {exito}</div>}
            <div style={s.modalFooter}>
              <button type="button" style={s.btnGris} onClick={onClose}>Cerrar</button>
              <button type="submit" style={s.btnAmarillo} disabled={loading || !!exito}>
                {loading ? 'Encolando...' : '⏳ Encolar cambio'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Modal: Aplicar pendientes ─────────────────────────────────────────────────
function ModalAplicarPendientes({ onClose, onSuccess }) {
  const [pendientes, setPendientes] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [aplicando,  setAplicando]  = useState(false)
  const [error,      setError]      = useState(null)
  const [resultado,  setResultado]  = useState(null)

  useEffect(() => {
    fetch('/api/admin/articulos/pendientes')
      .then(r => r.json())
      .then(d => setPendientes(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleCancelar(id) {
    await fetch(`/api/admin/articulos/pendientes/${id}`, { method: 'DELETE' })
    setPendientes(p => p.filter(x => x.id !== id))
    onSuccess()
  }

  async function handleAplicar() {
    setAplicando(true); setError(null)
    try {
      const res = await fetch('/api/admin/articulos/pendientes/aplicar', { method: 'POST' })
      const d   = await res.json()
      if (!res.ok) { setError(d.error); return }
      setResultado(d)
      onSuccess()
    } catch (e) { setError(e.message) }
    finally { setAplicando(false) }
  }

  return (
    <div style={s.overlay} onClick={e => e.target === e.currentTarget && !aplicando && onClose()}>
      <div style={{ ...s.modal, maxWidth: 720 }}>
        <div style={s.modalHeader}>
          <h3 style={s.modalTitulo}>✅ Aplicar cambios pendientes</h3>
          <button style={s.btnCerrar} onClick={onClose} disabled={aplicando}>✕</button>
        </div>

        {loading && <p style={{ color: '#4a7fa5' }}>Cargando pendientes...</p>}

        {!loading && !resultado && (<>
          {pendientes.length === 0 ? (
            <p style={{ color: '#8899aa' }}>No hay cambios pendientes en este momento.</p>
          ) : (<>
            <p style={{ color: '#8899aa', fontSize: 12, marginBottom: 12 }}>
              Se van a aplicar <strong style={{ color: 'white' }}>{pendientes.length}</strong> cambio{pendientes.length !== 1 ? 's' : ''} a core.products de forma atómica:
            </p>
            <div style={{ ...s.tablaWrap, maxHeight: '52vh', overflow: 'auto' }}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Artículo actual</th>
                    <th style={s.th}>Cambios propuestos</th>
                    <th style={s.th}>Encolado</th>
                    <th style={s.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map(p => (
                    <tr key={p.id}>
                      <td style={{ ...s.td, color: '#F4C430', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {p.product_name}
                        {!p.product_active && <span style={{ color: '#fca5a5', fontSize: 10, marginLeft: 6 }}>INACTIVO</span>}
                      </td>
                      <td style={{ ...s.td, fontSize: 11 }}>
                        {Object.entries(p.payload).map(([key, val]) => (
                          <div key={key} style={{ marginBottom: 2 }}>
                            <span style={{ color: '#4a7fa5' }}>{FIELD_LABELS[key] || key}: </span>
                            <span style={{ color: '#F4C430', fontWeight: 600 }}>
                              {val === null ? '—' : val === true ? 'sí' : val === false ? 'no' : String(val)}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td style={{ ...s.td, fontSize: 10, color: '#556677', whiteSpace: 'nowrap' }}>{tsAR(p.created_at)}</td>
                      <td style={s.td}>
                        <button
                          style={{ ...s.btnGris, fontSize: 10, padding: '2px 7px', color: '#fca5a5', border: '1px solid #ef444433' }}
                          onClick={() => handleCancelar(p.id)}
                          disabled={aplicando}
                        >✕ Cancelar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <div style={s.errorBox}>⚠ {error}</div>}
            <div style={s.modalFooter}>
              <button style={s.btnGris} onClick={onClose} disabled={aplicando}>Cerrar</button>
              <button
                style={{ ...s.btnAmarillo, background: '#0d2518', border: '1px solid #4ade80', color: '#4ade80' }}
                onClick={handleAplicar}
                disabled={aplicando || pendientes.length === 0}
              >
                {aplicando ? 'Aplicando...' : `✅ Confirmar y aplicar ${pendientes.length} cambio${pendientes.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>)}
        </>)}

        {resultado && (
          <div style={col}>
            <div style={{ background: '#0d2518', border: '1px solid #4ade80', borderRadius: 8, padding: 16 }}>
              <p style={{ color: '#4ade80', fontWeight: 700, fontSize: '1rem', margin: '0 0 8px' }}>✅ Aplicación completada</p>
              <p style={{ color: '#c8d8e8', margin: '0 0 4px' }}>Aplicados correctamente: <strong>{resultado.applied}</strong></p>
              {resultado.failed > 0 && (
                <p style={{ color: '#fca5a5', margin: 0 }}>Fallidos: <strong>{resultado.failed}</strong> — marcados como FAILED en la cola (ver logs del servidor)</p>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.btnAmarillo} onClick={onClose}>Cerrar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO B — Catálogo & Stock
// ═══════════════════════════════════════════════════════════════════════════════
function SeccionCatalogo({ pendingProductIds = new Set(), onRefreshPending }) {
  const [sectores,    setSectores]    = useState([])
  const [sectorId,    setSectorId]    = useState('')
  const [modoAlertas, setModoAlertas] = useState(false)
  const [buscar,      setBuscar]      = useState('')
  const [productos,   setProductos]   = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [pagina,      setPagina]      = useState(0)
  const POR_PAGINA = 80

  useEffect(() => {
    fetch('/api/admin/sectores').then(r => r.json()).then(d => { if (!d.error) setSectores(d) }).catch(() => {})
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
            : sectorId
              ? `${productos.length} productos · stock en ${sectorNombre || '?'}`
              : 'Seleccioná un sector para ver el catálogo filtrado por supply_rules'}
        </p>
      </div>

      <div style={s.controlesBar}>
        <button
          style={{ ...s.btnToggle, ...(modoAlertas ? s.btnToggleRojo : {}) }}
          onClick={() => { setModoAlertas(v => !v); setBuscar(''); setSectorId('') }}
        >🔴 Alertas de stock</button>
        {!modoAlertas && (
          <select value={sectorId} onChange={e => setSectorId(e.target.value)} style={s.select}>
            <option value="">— Sin sector —</option>
            {sectores.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        {!modoAlertas && (
          <input type="text" placeholder="Buscar por nombre..."
            value={buscar} onChange={e => setBuscar(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && cargar()}
            style={{ ...s.inputBuscar, flex: 1 }} />
        )}
        <button style={s.btnAmarillo} onClick={cargar} disabled={loading}>
          {loading ? 'Cargando...' : '↻ Cargar'}
        </button>
      </div>

      {error   && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && <div style={s.cargando}>Cargando productos...</div>}

      {!loading && !error && productos.length === 0 && (
        <div style={s.cargando}>
          {modoAlertas ? 'No hay productos bajo punto de reorden.' :
           sectorId    ? 'Sin productos para este sector.' :
                         'Seleccioná un sector y hacé clic en "Cargar".'}
        </div>
      )}

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
                const sc      = stockColor(p.stock_status)
                const pending = pendingProductIds.has(p.id)
                return (
                  <tr key={p.id} style={{ background: pending ? '#161000' : 'transparent' }}>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ color: '#e2eaf4', fontWeight: 500 }}>{p.nombre}</span>
                        {pending && (
                          <span style={{ background: '#2a1e00', color: '#fde68a', border: '1px solid #f59e0b55', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', whiteSpace: 'nowrap' }}>
                            ⏳ cambio pendiente
                          </span>
                        )}
                        {p.sub_condition && <span style={s.chip}>{p.sub_condition}</span>}
                      </div>
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
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const t = setInterval(cargar, 60_000); return () => clearInterval(t) }, [cargar])

  function semaforoColor(sec) {
    const pend  = sec.items_pendientes ?? 0
    const listos = sec.items_listos    ?? 0
    const horas  = sec.promedio_horas_espera ?? 0
    if (pend === 0)  return { border: '#22c55e', bg: '#0d2518', dot: '#22c55e', label: 'Sin pendientes' }
    if (horas > 4)   return { border: '#ef4444', bg: '#3b0a0a', dot: '#ef4444', label: 'Demorado' }
    if (listos > 0)  return { border: '#f59e0b', bg: '#2a1e00', dot: '#f59e0b', label: 'En progreso' }
    return              { border: '#f59e0b', bg: '#2a1e00', dot: '#f59e0b', label: 'Pendiente' }
  }

  return (
    <div style={col}>
      <div style={{ ...s.seccionHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={s.seccionTitulo}>🟢 Estado en vivo</h2>
          <p style={s.seccionSub}>Auto-actualización cada 60 segundos</p>
        </div>
        <button style={s.btnGris} onClick={cargar} disabled={loading}>↻ Actualizar</button>
      </div>

      {error   && <div style={s.errorBox}>⚠ {error}</div>}
      {loading && !data && <div style={s.cargando}>Cargando estado...</div>}

      {data && (<>
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
  const [detalle,    setDetalle]    = useState(null)
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
    finally { setLoading(false) }
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
    finally { setLoadingDet(false) }
  }

  return (
    <div style={col}>
      <h2 style={s.seccionTitulo}>📋 Pedidos — Solo lectura</h2>
      <div style={s.tabs}>
        {[['sucursal','🏪 Pedidos de sucursal'],['interna','⚙️ Órdenes internas']].map(([id, label]) => (
          <button key={id} style={{ ...s.tab, ...(tab === id ? s.tabActivo : {}) }} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
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
        <button style={s.btnAmarillo} onClick={() => cargar(0)} disabled={loading}>{loading ? 'Cargando...' : '↻ Buscar'}</button>
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
                  <th style={s.th}>Sucursal</th><th style={s.th}>Entrega</th>
                </> : <>
                  <th style={s.th}>Desde</th><th style={s.th}>Hacia</th><th style={s.th}>Tipo</th>
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
                const sc         = STATUS_COLOR[row.status] || '#8899aa'
                const entityType = tab === 'sucursal' ? 'branch_order' : 'internal_order'
                const abierto    = detalle?.id === row.id
                return (
                  <>
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
                    {abierto && (
                      <tr key={row.id + '-det'}>
                        <td colSpan={8} style={{ padding: 0, borderBottom: '2px solid #1e3050' }}>
                          <FilaDetalle detalle={detalle} loading={loadingDet} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
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
              const sc  = STATUS_COLOR[it.estado] || '#8899aa'
              const qty = it.producido ?? it.confirmado
              return (
                <tr key={it.id}>
                  <td style={s.td}>{it.producto}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{it.pedido} {it.unidad}</td>
                  <td style={{ ...s.td, textAlign: 'right', color: '#4ade80' }}>{qty != null ? `${qty} ${it.unidad}` : '—'}</td>
                  <td style={s.td}><span style={{ color: sc, fontSize: 10, fontWeight: 600 }}>{STATUS_LABEL[it.estado] || it.estado}</span></td>
                  {it.sector && <td style={{ ...s.td, color: '#8899aa', fontSize: 11 }}>{it.sector}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <p style={s.subSeccion}>Historial de estados</p>
        {historia.length === 0 ? (
          <p style={{ color: '#556677', fontSize: 12 }}>Sin registros en audit.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {historia.map((ev, i) => {
              const cNew = STATUS_COLOR[ev.new_status] || '#8899aa'
              return (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
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
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {data.kpis.map(k => (
            <div key={k.metrica} style={{ background: '#162236', border: '1px solid #243550', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#4a7fa5', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{k.metrica}</div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: 28 }}>{k.valor}</div>
            </div>
          ))}
        </div>

        {data.produccion.length > 0 && (
          <div>
            <p style={s.subSeccion}>Producción últimos 30 días</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Fecha</th><th style={s.th}>Sector</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Órdenes</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Items</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Cantidad</th>
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

        {data.remitos.length > 0 && (
          <div>
            <p style={s.subSeccion}>Remitos — últimos 7 días</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Remito</th><th style={s.th}>Tipo</th><th style={s.th}>Sucursal</th>
                    <th style={s.th}>Estado</th><th style={{ ...s.th, textAlign: 'center' }}>Items</th>
                    <th style={s.th}>Despachado</th><th style={s.th}>Entregado</th>
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
                        <td style={s.td}><span style={{ color: sc, fontSize: 11, fontWeight: 600 }}>{r.status}</span></td>
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

        {data.stockMovimientos.length > 0 && (
          <div>
            <p style={s.subSeccion}>Movimientos de stock — últimas 24 hs</p>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead>
                  <tr>
                    <th style={s.th}>Hora</th><th style={s.th}>Sector</th><th style={s.th}>Producto</th>
                    <th style={s.th}>Tipo</th><th style={{ ...s.th, textAlign: 'right' }}>Cant.</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Antes</th><th style={{ ...s.th, textAlign: 'right' }}>Después</th>
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
  // Layout
  page:          { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0 },
  logoBlanco:    { color: 'white', fontSize: '1rem', fontWeight: 700, letterSpacing: '.06em' },
  logoAmarillo:  { color: '#F4C430', fontSize: '1rem', fontWeight: 700, letterSpacing: '.06em' },
  headerSub:     { color: '#4a7fa5', fontSize: 12, marginLeft: 4 },
  userLabel:     { color: '#8899aa', fontSize: 13 },
  btnSalir:      { background: 'none', border: '1px solid #243550', borderRadius: 5, color: '#8899aa', fontSize: 12, padding: '4px 10px', cursor: 'pointer' },
  shell:         { display: 'flex', flex: 1, minHeight: 0 },
  sidebar:       { width: 210, flexShrink: 0, background: '#0d1a2a', borderRight: '1px solid #1e3050', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  sidebarTitulo: { color: '#4a7fa5', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', margin: '0 0 8px', paddingLeft: 8 },
  navBtn:        { background: 'none', border: 'none', borderRadius: 7, color: '#7a9bb8', fontSize: 13, fontWeight: 500, padding: '9px 12px', cursor: 'pointer', textAlign: 'left' },
  navBtnActivo:  { background: '#162236', color: '#F4C430', fontWeight: 700, border: '1px solid #243550' },
  main:          { flex: 1, padding: '1.5rem 2rem', overflowY: 'auto' },

  // Barra de carga
  barra:         { background: '#0a1520', borderBottom: '1px solid #1e3050', padding: '6px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 },
  btnMenu:       { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, fontWeight: 600, padding: '5px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  badgePending:  { background: '#F4C430', color: '#0f1c2e', borderRadius: '50%', fontSize: 10, fontWeight: 900, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dropdown:      { position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#162236', border: '1px solid #243550', borderRadius: 8, zIndex: 200, minWidth: 280, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.5)' },
  dropItem:      { background: 'none', border: 'none', color: '#c8d8e8', fontSize: 13, padding: '10px 16px', cursor: 'pointer', textAlign: 'left', transition: 'background .1s' },

  // Secciones
  seccionHeader: { marginBottom: 4 },
  seccionTitulo: { color: 'white', fontSize: '1.2rem', fontWeight: 700, margin: 0 },
  seccionSub:    { color: '#8899aa', fontSize: 12, marginTop: 4 },
  subSeccion:    { color: '#4a7fa5', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', margin: '4px 0 6px' },

  // Controles
  controlesBar:  { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#0d1a2a', border: '1px solid #1e3050', borderRadius: 8, padding: '10px 14px' },
  select:        { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', cursor: 'pointer', outline: 'none' },
  inputBuscar:   { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', outline: 'none', minWidth: 160 },
  inputFecha:    { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '6px 10px', outline: 'none', cursor: 'pointer' },
  btnToggle:     { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#8899aa', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' },
  btnToggleRojo: { background: '#3b0a0a', border: '1px solid #ef4444', color: '#fca5a5' },
  btnAmarillo:   { background: '#162236', border: '1px solid #F4C430', borderRadius: 6, color: '#F4C430', fontSize: 12, fontWeight: 700, padding: '6px 16px', cursor: 'pointer' },
  btnGris:       { background: '#162236', border: '1px solid #243550', borderRadius: 6, color: '#7a9bb8', fontSize: 12, fontWeight: 600, padding: '6px 14px', cursor: 'pointer' },

  // Tabs
  tabs:          { display: 'flex', gap: 4, borderBottom: '1px solid #243550' },
  tab:           { background: 'none', border: 'none', color: '#8899aa', fontSize: 13, fontWeight: 600, padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:     { color: '#F4C430', borderBottom: '2px solid #F4C430' },

  // Tabla
  tablaWrap:     { overflow: 'auto', border: '1px solid #1e3050', borderRadius: 8 },
  tabla:         { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:            { background: '#0d1a2a', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #1e3050', position: 'sticky', top: 0, whiteSpace: 'nowrap' },
  td:            { color: '#c8d8e8', padding: '7px 12px', borderBottom: '1px solid #162236', verticalAlign: 'middle' },

  // Badges / chips
  chip:          { display: 'inline-block', background: '#1a2a3a', color: '#7dd3fc', border: '1px solid #243550', borderRadius: 3, fontSize: 9, fontWeight: 600, padding: '0 5px', marginLeft: 6, verticalAlign: 'middle' },
  flag:          { background: '#0f1c2e', color: '#4a7fa5', border: '1px solid #1e3050', borderRadius: 3, fontSize: 9, padding: '0 4px', letterSpacing: '.03em' },

  // Paginación / mensajes
  paginacion:    { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '12px 0' },
  cargando:      { padding: '3rem', textAlign: 'center', color: '#8899aa' },
  errorBox:      { background: '#3b0a0a', border: '1px solid #ef4444', borderRadius: 8, color: '#fca5a5', padding: '12px 16px', fontSize: 13 },
  okBox:         { background: '#0d2518', border: '1px solid #4ade80', borderRadius: 8, color: '#4ade80', padding: '12px 16px', fontSize: 13 },

  // Modales
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 },
  modal:         { background: '#162236', border: '1px solid #243550', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 },
  modalHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitulo:   { color: 'white', margin: 0, fontSize: '1rem', fontWeight: 700 },
  modalFooter:   { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  btnCerrar:     { background: 'none', border: 'none', color: '#8899aa', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 },

  // Formulario (modales)
  label:         { color: '#4a7fa5', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4, display: 'block' },
  input:         { background: '#0f1c2e', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '7px 10px', width: '100%', outline: 'none', boxSizing: 'border-box' },
  inputSel:      { background: '#0f1c2e', border: '1px solid #243550', borderRadius: 6, color: '#c8d8e8', fontSize: 13, padding: '7px 10px', width: '100%', outline: 'none', cursor: 'pointer' },
}
