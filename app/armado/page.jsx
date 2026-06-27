'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

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
  if (!str) return ''
  const d = typeof str === 'string' && str.length === 10
    ? new Date(str + 'T12:00:00')
    : new Date(str)
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(d)
}

function sigla(nombre) {
  if (!nombre) return '?'
  return nombre.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4)
}

const COLORES_TIPO = {
  horno:    { bg: '#1a0a00', border: '#92400e', label: '#fbbf24' },
  freir:    { bg: '#0a001a', border: '#5b21b6', label: '#c4b5fd' },
  semillas: { bg: '#001a0a', border: '#065f46', label: '#6ee7b7' },
  hojaldre: { bg: '#001220', border: '#1e40af', label: '#93c5fd' },
  copetin:  { bg: '#1a1000', border: '#78350f', label: '#fde68a' },
}

export default function ArmadoPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]           = useState('landing')
  const [tabPedidos, setTabPedidos] = useState('total')
  const [datos, setDatos]           = useState(null)
  const [loading, setLoading]       = useState(false)
  const [confirmaciones, setConf]   = useState({})
  const [enviando, setEnviando]     = useState(false)
  const [estimacion, setEstimacion] = useState(null)
  const [loadingEst, setLoadingEst] = useState(false)
  const [toast, setToast]           = useState(null)
  // ── Cocina ──
  const [productosCocina, setProductosCocina]   = useState({ emp: [], fracc: [] })
  const [loadingProductos, setLoadingProductos] = useState(false)
  const [cantidadesCocina, setCantidadesCocina] = useState({})
  const [enviandoCocina, setEnviandoCocina]     = useState(false)
  // Default: mañana (pedidos hechos anoche)
  const [fechaSeleccionada, setFechaSeleccionada] = useState(fechaEnAR(1))

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargarPedidos = async (fecha) => {
    setLoading(true)
    const f = fecha || fechaSeleccionada
    try {
      const res = await fetch(`/api/armado/pedidos?fecha=${f}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setDatos(data)

      const initConf = {}
      data.por_sucursal.forEach(suc => {
        suc.items.forEach(item => {
          initConf[item.id] = {
            listo:    item.item_status === 'READY_FOR_PICKUP',
            cantidad: item.confirmed_quantity ?? item.requested_quantity,
          }
        })
      })
      setConf(initConf)
    } catch {
      mostrarToast('Error al cargar pedidos', 'err')
    } finally {
      setLoading(false)
    }
  }

  const cambiarFecha = (nuevaFecha) => {
    setFechaSeleccionada(nuevaFecha)
    setDatos(null)
    cargarPedidos(nuevaFecha)
  }

  const cargarEstimacion = async () => {
    setLoadingEst(true)
    try {
      const res = await fetch(`/api/armado/estimacion?fecha=${fechaEnAR(1)}`)
      if (!res.ok) throw new Error()
      setEstimacion(await res.json())
    } catch {
      mostrarToast('Error al calcular estimación', 'err')
    } finally {
      setLoadingEst(false)
    }
  }

  const cargarProductosCocina = async () => {
    setLoadingProductos(true)
    try {
      const res = await fetch('/api/armado/cocina/productos')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setProductosCocina(data)
      const init = {}
      ;[...data.emp, ...data.fracc].forEach(p => { init[p.product_id] = '' })
      setCantidadesCocina(init)
    } catch {
      mostrarToast('Error al cargar productos de Cocina', 'err')
    } finally {
      setLoadingProductos(false)
    }
  }

  const enviarPedidoCocina = async () => {
    const items = [...productosCocina.emp, ...productosCocina.fracc]
      .filter(p => Number(cantidadesCocina[p.product_id]) > 0)
      .map(p => ({
        product_id: p.product_id,
        quantity:   Number(cantidadesCocina[p.product_id]),
        unit:       p.base_unit || 'KG',
      }))
    if (!items.length) { mostrarToast('Ingresá al menos una cantidad', 'err'); return }
    if (!confirm(`¿Confirmar pedido a Cocina con ${items.length} producto${items.length > 1 ? 's' : ''}?`)) return
    setEnviandoCocina(true)
    try {
      const res = await fetch('/api/armado/cocina', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) throw new Error()
      const { order_number } = await res.json()
      mostrarToast(`Pedido ${order_number} enviado a Cocina ✓`)
      const reset = {}
      ;[...productosCocina.emp, ...productosCocina.fracc].forEach(p => { reset[p.product_id] = '' })
      setCantidadesCocina(reset)
    } catch {
      mostrarToast('Error al enviar pedido', 'err')
    } finally {
      setEnviandoCocina(false)
    }
  }

  const irAPedidos = () => { setVista('pedidos'); cargarPedidos() }
  const irACocina  = () => { setVista('cocina');  cargarProductosCocina() }

  const confirmar = async () => {
    const payload = Object.entries(confirmaciones)
      .map(([item_id, { listo, cantidad }]) => ({ item_id, listo, confirmed_quantity: cantidad }))
    const listos = payload.filter(p => p.listo)
    if (!listos.length) { mostrarToast('Marcá al menos un item como listo', 'err'); return }
    if (!confirm(`¿Confirmar ${listos.length} item${listos.length > 1 ? 's' : ''} como listos?`)) return

    setEnviando(true)
    try {
      const res = await fetch('/api/armado/pedidos', {
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

  const imprimirComandas = () => {
    if (!datos?.por_sucursal?.length) return
    const sucursalesConEmpanadas = datos.por_sucursal.filter(suc => suc.items.some(i => i.es_empanada))
    if (!sucursalesConEmpanadas.length) { mostrarToast('No hay empanadas para imprimir', 'err'); return }

    const htmlComandas = sucursalesConEmpanadas.map(suc => {
      const horno    = suc.items.filter(i => i.sub_condition === 'horno')
      const freir    = suc.items.filter(i => i.sub_condition === 'freir')
      const semillas = suc.items.filter(i => i.sub_condition === 'semillas')

      const filas = (lista) => lista.map(i => `
        <tr>
          <td>${i.product_name}</td>
          <td style="text-align:center;font-weight:700">${confirmaciones[i.id]?.cantidad ?? i.requested_quantity}</td>
          <td style="color:#666;font-size:11px">${i.unit}</td>
        </tr>
      `).join('')

      const seccion = (titulo, lista, color) => lista.length ? `
        <div class="comanda-seccion" style="background:${color}">${titulo}</div>
        <table class="comanda-tabla">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Un.</th></tr></thead>
          <tbody>${filas(lista)}</tbody>
        </table>
      ` : ''

      return `
        <div class="comanda">
          <div class="comanda-header">
            <span class="comanda-sigla">${sigla(suc.branch_name)}</span>
            <div>
              <div class="comanda-nombre">${suc.branch_name || suc.branch_code}</div>
              <div class="comanda-fecha">${fechaLegible(suc.delivery_date)}</div>
            </div>
          </div>
          ${seccion('HORNO', horno, '#FFF3CD')}
          ${seccion('PARA FREÍR', freir, '#E8D5F5')}
          ${seccion('SEMILLAS', semillas, '#D5F5E3')}
          ${!horno.length && !freir.length && !semillas.length
            ? '<p style="color:#999;font-size:12px;padding:8px">Sin empanadas</p>' : ''}
        </div>
      `
    })

    const hojas = []
    for (let i = 0; i < htmlComandas.length; i += 2) {
      hojas.push(`
        <div class="hoja">
          ${htmlComandas[i]}
          ${htmlComandas[i + 1] || '<div class="comanda comanda-vacia"></div>'}
        </div>
      `)
    }

    const ventana = window.open('', '_blank')
    ventana.document.write(`
      <!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Comandas Armado — ${fechaSeleccionada}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:system-ui,sans-serif;background:white}
        @media print{@page{size:A4;margin:8mm}body{margin:0}}
        .hoja{width:210mm;min-height:148mm;display:flex;page-break-after:always;border:1px solid #ddd}
        .comanda{width:105mm;min-height:148mm;padding:8mm;border-right:1px dashed #999;display:flex;flex-direction:column;gap:6px}
        .comanda:last-child{border-right:none}
        .comanda-vacia{background:#fafafa}
        .comanda-header{display:flex;align-items:center;gap:10px;padding-bottom:8px;border-bottom:2px solid #000;margin-bottom:6px}
        .comanda-sigla{background:#F4C430;border:2px solid #000;border-radius:6px;font-size:20px;font-weight:900;padding:4px 8px;letter-spacing:1px}
        .comanda-nombre{font-size:15px;font-weight:700;line-height:1.2}
        .comanda-fecha{font-size:11px;color:#555}
        .comanda-seccion{font-size:10px;font-weight:700;letter-spacing:1px;color:#333;padding:2px 6px;border-radius:3px;margin-top:4px;border:1px solid #ccc}
        .comanda-tabla{width:100%;border-collapse:collapse;font-size:12px}
        .comanda-tabla th{background:#F4C430;font-weight:700;padding:3px 6px;text-align:left;border:1px solid #000;font-size:10px}
        .comanda-tabla td{padding:3px 6px;border:1px solid #ccc}
        .comanda-tabla tr:nth-child(even) td{background:#f9f9f9}
      </style></head><body>
      ${hojas.join('')}
      <script>window.onload=()=>window.print()<\/script>
      </body></html>
    `)
    ventana.document.close()
  }

  if (status === 'loading') return <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>

  const hayListos = Object.values(confirmaciones).some(c => c.listo)

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
          <span style={s.logoCyan}>ARMADO</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.userLabel}>{session?.user?.name}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ══ LANDING ══ */}
      {vista === 'landing' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <h2 style={s.titulo}>Sector Armado</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button style={s.btnLanding} onClick={irAPedidos}>
              <span style={{ fontSize: '2rem' }}>📋</span>
              <span>Pedido del día</span>
              <span style={s.btnSub}>Ver y confirmar pedidos</span>
            </button>
            <button style={{ ...s.btnLanding, borderColor: '#92400e', background: '#1c1000' }} onClick={irACocina}>
              <span style={{ fontSize: '2rem' }}>🍳</span>
              <span>Pedir a Cocina</span>
              <span style={s.btnSub}>Seleccioná recetas y kg</span>
            </button>
          </div>
        </main>
      )}

      {/* ══ PEDIDOS DEL DÍA ══ */}
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
              Pendientes hasta: <strong style={{ color: '#F4C430' }}>{fechaLegible(fechaSeleccionada)}</strong>
            </span>
          </div>

          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(tabPedidos === 'total' ? s.tabActivo : {}) }} onClick={() => setTabPedidos('total')}>
              Pedido total
            </button>
            <button style={{ ...s.tab, ...(tabPedidos === 'sucursales' ? s.tabActivo : {}) }} onClick={() => setTabPedidos('sucursales')}>
              Por sucursales
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando pedidos...</div>
          ) : !datos ? null : (
            <>
              {/* ── TAB TOTAL ── */}
              {tabPedidos === 'total' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {datos.total_por_tipo.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos pendientes para esta fecha</p>
                  ) : datos.total_por_tipo.map(grupo => {
                    const col = COLORES_TIPO[grupo.tipo] || { bg: '#162236', border: '#243550', label: '#7a9bb8' }
                    return (
                      <div key={grupo.tipo} style={{ border: `1px solid ${col.border}`, borderRadius: '10px', overflow: 'hidden' }}>
                        <div style={{ background: col.bg, padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${col.border}` }}>
                          <span style={{ color: col.label, fontWeight: '700', fontSize: '13px', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                            {grupo.label}
                          </span>
                          <span style={{ color: col.label, fontWeight: '700', fontSize: '13px' }}>
                            Total: {grupo.subtotal} u
                          </span>
                        </div>
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
                            {grupo.productos.map(item => (
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
                    )
                  })}

                  {/* Resumen de tapas */}
                  {datos.resumen_tapas?.length > 0 && (
                    <div style={{ background: '#0f1c2e', border: '1px solid #F4C430', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
                      <p style={{ color: '#F4C430', fontWeight: '700', fontSize: '13px', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '12px' }}>
                        Resumen de tapas — pendientes hasta {fechaLegible(fechaSeleccionada)}
                      </p>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {datos.resumen_tapas.map(t => (
                          <div key={t.tipo} style={{ background: '#162236', border: '1px solid #243550', borderRadius: '8px', padding: '10px 20px', textAlign: 'center' }}>
                            <div style={{ color: '#8899aa', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t.tipo}</div>
                            <div style={{ color: 'white', fontWeight: '700', fontSize: '22px', marginTop: '4px' }}>{t.total}</div>
                            <div style={{ color: '#8899aa', fontSize: '10px' }}>unidades</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB POR SUCURSALES ── */}
              {tabPedidos === 'sucursales' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {datos.por_sucursal.length === 0 ? (
                    <p style={{ textAlign: 'center', color: '#8899aa', padding: '2rem' }}>Sin pedidos pendientes para esta fecha</p>
                  ) : datos.por_sucursal.map(suc => (
                    <div key={suc.branch_code} style={s.sucCard}>
                      <div style={s.sucHeader}>
                        <div style={s.sucSigla}>{sigla(suc.branch_name)}</div>
                        <div>
                          <div style={s.sucNombre}>{suc.branch_name || suc.branch_code}</div>
                          <div style={s.sucFecha}>Entrega: {fechaLegible(suc.delivery_date)}</div>
                        </div>
                      </div>
                      <table style={s.tabla}>
                        <thead>
                          <tr>
                            <th style={s.th}>Producto</th>
                            <th style={{ ...s.th, width: '90px' }}>Tipo</th>
                            <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Pedido</th>
                            <th style={{ ...s.th, width: '120px', textAlign: 'center' }}>Confirmar</th>
                            <th style={{ ...s.th, width: '70px', textAlign: 'center' }}>Listo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suc.items.map(item => {
                            const conf = confirmaciones[item.id] || { listo: false, cantidad: item.requested_quantity }
                            const col  = COLORES_TIPO[item.sub_condition] || {}
                            return (
                              <tr key={item.id} style={{ background: conf.listo ? '#0d2518' : 'transparent' }}>
                                <td style={s.td}>{item.product_name}</td>
                                <td style={{ ...s.td, fontSize: '11px' }}>
                                  <span style={{ background: col.bg || '#162236', color: col.label || '#8899aa', border: `1px solid ${col.border || '#243550'}`, borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: '600' }}>
                                    {item.sub_condition === 'horno' ? 'Horno' : item.sub_condition === 'freir' ? 'Freír' : item.sub_condition === 'semillas' ? 'Semillas' : item.sub_condition || '—'}
                                  </span>
                                </td>
                                <td style={{ ...s.td, textAlign: 'center', color: '#7dd3fc', fontWeight: '600' }}>
                                  {item.requested_quantity} {item.unit}
                                </td>
                                <td style={{ ...s.td, textAlign: 'center' }}>
                                  <input
                                    type="number" min="0"
                                    value={conf.cantidad}
                                    onChange={e => setConf(prev => ({ ...prev, [item.id]: { ...prev[item.id], cantidad: Math.max(0, parseInt(e.target.value) || 0) } }))}
                                    onClick={e => e.target.select()}
                                    style={s.inputCantidad}
                                  />
                                </td>
                                <td style={{ ...s.td, textAlign: 'center' }}>
                                  <input
                                    type="checkbox" checked={conf.listo}
                                    onChange={e => setConf(prev => ({ ...prev, [item.id]: { ...prev[item.id], listo: e.target.checked } }))}
                                    style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#22c55e' }}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem', paddingBottom: '2rem' }}>
                <button style={s.btnRecargar} onClick={() => cargarPedidos()}>↻ Recargar</button>
                <button style={s.btnImprimir} onClick={imprimirComandas}>🖨️ Imprimir comandas A5</button>
                <button
                  style={{ ...s.btnConfirmar, opacity: (!hayListos || enviando) ? 0.5 : 1, cursor: (!hayListos || enviando) ? 'not-allowed' : 'pointer' }}
                  onClick={confirmar} disabled={!hayListos || enviando}
                >
                  {enviando ? 'Confirmando...' : '✓ Confirmar listos'}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* ══ PEDIR A COCINA ══ */}
      {vista === 'cocina' && (
        <main style={s.main}>
          <p style={s.subtitulo}>Seleccioná recetas y cantidades (Kg)</p>
          {loadingProductos ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando productos...</div>
          ) : (
            <>
              <div style={ck.grid}>
                <div style={ck.col}>
                  <div style={{ ...ck.colHeader, borderColor: '#F4C430' }}>
                    <span style={{ ...ck.colTitulo, color: '#F4C430' }}>EMP</span>
                    <span style={ck.colSub}>Rellenos de empanada</span>
                  </div>
                  <table style={ck.tabla}>
                    <thead><tr>
                      <th style={ck.th}>Receta</th>
                      <th style={{ ...ck.th, width: '120px', textAlign: 'center' }}>Cantidad (Kg)</th>
                    </tr></thead>
                    <tbody>
                      {productosCocina.emp.length === 0 ? (
                        <tr><td colSpan={2} style={{ ...ck.td, color: '#4a7fa5', textAlign: 'center', padding: '1.5rem' }}>Sin productos</td></tr>
                      ) : productosCocina.emp.map(p => (
                        <tr key={p.product_id} style={{ background: Number(cantidadesCocina[p.product_id]) > 0 ? '#1a2f1a' : 'transparent' }}>
                          <td style={ck.td}>{p.product_name}</td>
                          <td style={{ ...ck.td, textAlign: 'center' }}>
                            <input type="number" min="0" step="0.5" placeholder="—"
                              value={cantidadesCocina[p.product_id] ?? ''}
                              onChange={e => setCantidadesCocina(prev => ({ ...prev, [p.product_id]: e.target.value }))}
                              onClick={e => e.target.select()}
                              style={{ ...ck.input, borderColor: Number(cantidadesCocina[p.product_id]) > 0 ? '#22c55e' : '#243550' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={ck.col}>
                  <div style={{ ...ck.colHeader, borderColor: '#7dd3fc' }}>
                    <span style={{ ...ck.colTitulo, color: '#7dd3fc' }}>FRACC</span>
                    <span style={ck.colSub}>Otros productos bulk</span>
                  </div>
                  <table style={ck.tabla}>
                    <thead><tr>
                      <th style={ck.th}>Receta</th>
                      <th style={{ ...ck.th, width: '120px', textAlign: 'center' }}>Cantidad (Kg)</th>
                    </tr></thead>
                    <tbody>
                      {productosCocina.fracc.length === 0 ? (
                        <tr><td colSpan={2} style={{ ...ck.td, color: '#4a7fa5', textAlign: 'center', padding: '1.5rem' }}>Sin productos</td></tr>
                      ) : productosCocina.fracc.map(p => (
                        <tr key={p.product_id} style={{ background: Number(cantidadesCocina[p.product_id]) > 0 ? '#1a2f1a' : 'transparent' }}>
                          <td style={ck.td}>{p.product_name}</td>
                          <td style={{ ...ck.td, textAlign: 'center' }}>
                            <input type="number" min="0" step="0.5" placeholder="—"
                              value={cantidadesCocina[p.product_id] ?? ''}
                              onChange={e => setCantidadesCocina(prev => ({ ...prev, [p.product_id]: e.target.value }))}
                              onClick={e => e.target.select()}
                              style={{ ...ck.input, borderColor: Number(cantidadesCocina[p.product_id]) > 0 ? '#22c55e' : '#243550' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {(() => {
                const cargados = [...(productosCocina.emp || []), ...(productosCocina.fracc || [])]
                  .filter(p => Number(cantidadesCocina[p.product_id]) > 0)
                return cargados.length > 0 ? (
                  <div style={ck.resumen}>
                    <span style={ck.resumenTxt}>
                      {cargados.length} producto{cargados.length > 1 ? 's' : ''} • {cargados.map(p => `${p.product_name} ${cantidadesCocina[p.product_id]} kg`).join(' · ')}
                    </span>
                  </div>
                ) : null
              })()}
              <div style={{ textAlign: 'center', marginTop: '1.5rem', paddingBottom: '2rem' }}>
                <button
                  style={{ ...s.btnConfirmar, opacity: enviandoCocina ? 0.5 : 1, cursor: enviandoCocina ? 'not-allowed' : 'pointer' }}
                  disabled={enviandoCocina} onClick={enviarPedidoCocina}
                >
                  {enviandoCocina ? 'Enviando...' : '✓ Confirmar pedido a Cocina'}
                </button>
              </div>
            </>
          )}
        </main>
      )}
    </div>
  )
}

const ck = {
  grid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '1rem' },
  col:       { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  colHeader: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: '#0f1c2e', borderBottom: '2px solid', borderLeft: '4px solid' },
  colTitulo: { fontWeight: '700', fontSize: '13px', letterSpacing: '.1em' },
  colSub:    { color: '#8899aa', fontSize: '11px' },
  tabla:     { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:        { background: '#0d1a2a', color: '#4a7fa5', padding: '6px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550' },
  td:        { color: '#c8d8e8', padding: '7px 12px', borderBottom: '1px solid #1a2a3a' },
  input:     { background: '#0f1c2e', border: '1px solid', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '90px', textAlign: 'center', outline: 'none' },
  resumen:   { background: '#0d2518', border: '1px solid #22c55e', borderRadius: '8px', padding: '10px 16px', margin: '0 0 8px', textAlign: 'center' },
  resumenTxt:{ color: '#4ade80', fontSize: '12px', lineHeight: '1.6' },
}

const s = {
  page:             { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:           { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0 },
  logoBlanco:       { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:         { color: '#F4C430', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  userLabel:        { color: '#8899aa', fontSize: '13px' },
  btnSalir:         { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:          { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  main:             { flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:           { color: 'white', fontSize: '1.5rem', fontWeight: '700', textAlign: 'center' },
  subtitulo:        { color: '#7a9bb8', fontSize: '14px', textAlign: 'center', marginBottom: '1rem' },
  btnLanding:       { background: '#162236', border: '2px solid #F4C430', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: '700', padding: '2rem 2.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '200px' },
  btnSub:           { color: '#8899aa', fontSize: '11px', fontWeight: '400' },
  fechaBar:         { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', padding: '10px 14px', background: '#0d1a2a', borderRadius: '8px', border: '1px solid #1e3050' },
  btnFechaShortcut: { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '12px', fontWeight: '600', padding: '5px 14px', cursor: 'pointer' },
  btnFechaActivo:   { background: '#2a1e00', border: '1px solid #F4C430', color: '#F4C430' },
  inputFecha:       { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#c8d8e8', fontSize: '13px', padding: '5px 10px', cursor: 'pointer', outline: 'none' },
  fechaLabel:       { color: '#8899aa', fontSize: '12px', marginLeft: '4px' },
  tabs:             { display: 'flex', gap: '4px', marginBottom: '1rem', borderBottom: '1px solid #243550' },
  tab:              { background: 'none', border: 'none', color: '#8899aa', fontSize: '14px', fontWeight: '600', padding: '8px 20px', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActivo:        { color: '#F4C430', borderBottom: '2px solid #F4C430' },
  tabla:            { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:               { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550', position: 'sticky', top: 0 },
  td:               { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  inputCantidad:    { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '15px', fontWeight: '600', padding: '5px 8px', width: '75px', textAlign: 'center', outline: 'none' },
  sucCard:          { background: '#162236', border: '1px solid #243550', borderRadius: '10px', overflow: 'hidden' },
  sucHeader:        { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550' },
  sucSigla:         { background: '#F4C430', color: '#0f1c2e', fontWeight: '900', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', letterSpacing: '1px' },
  sucNombre:        { color: 'white', fontWeight: '700', fontSize: '14px' },
  sucFecha:         { color: '#8899aa', fontSize: '11px' },
  btnRecargar:      { background: 'none', border: '1px solid #243550', borderRadius: '7px', color: '#7a9bb8', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer' },
  btnImprimir:      { background: 'none', border: '1px solid #F4C430', borderRadius: '7px', color: '#F4C430', fontSize: '13px', fontWeight: '600', padding: '10px 20px', cursor: 'pointer' },
  btnConfirmar:     { background: '#22c55e', border: 'none', borderRadius: '7px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '10px 24px', cursor: 'pointer' },
  toast:            { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
