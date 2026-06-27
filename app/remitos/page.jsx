'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'

// ─── Datos de la empresa (para el PDF) ───────────────────────────────────────
const EMPRESA = {
  nombre:    'La Chacha S.R.L',
  domicilio: 'Av. Rivadavia 1630',
  codPostal: '9000',
  ciudad:    'Cdro. Rivadavia – Chubut',
  ingBrutos: '907-333021-1',
  cuit:      '30-67025596-0',
  inicio:    '01-09-1994',
  iva:       'RESPONSABLE INSCRIPTO',
  tel:       '(0297) 446-4029',
  cod:       '091',
}

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

// ─── Generador de PDF del remito (abre ventana de impresión) ─────────────────
function imprimirRemito(sucursal, items, fecha) {
  const filas = items.map((item, i) => `
    <tr>
      <td style="border:1px solid #ccc;padding:6px 8px;font-size:12px">${item.codigo_tango || ''}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-size:12px">${item.product_name}</td>
      <td style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:center">${item.confirmed_quantity} ${item.unit}</td>
    </tr>
  `).join('')

  const ventana = window.open('', '_blank')
  ventana.document.write(`
    <!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>Remito — ${sucursal.branch_name || sucursal.branch_code}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;padding:16px;font-size:12px;color:#000}
      @media print{@page{size:A4;margin:10mm}body{padding:0}}
      .remito{border:2px solid #000;padding:0;max-width:780px;margin:0 auto}
      .header{display:flex;border-bottom:2px solid #000}
      .header-logo{padding:12px 16px;border-right:2px solid #000;display:flex;align-items:center;min-width:260px}
      .header-tipo{padding:12px 16px;border-right:2px solid #000;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:80px}
      .header-tipo .letra{font-size:40px;font-weight:900;line-height:1}
      .header-tipo .cod{font-size:11px;font-weight:700}
      .header-titulo{padding:12px 16px;display:flex;align-items:center;flex:1}
      .header-titulo h1{font-size:32px;font-weight:900;letter-spacing:2px}
      .datos{display:flex;border-bottom:2px solid #000}
      .datos-left{padding:10px 16px;border-right:2px solid #000;flex:1;line-height:1.6}
      .datos-right{padding:10px 16px;flex:1;line-height:1.6}
      .destino{padding:12px 16px;border-bottom:2px solid #000;min-height:60px}
      .destino strong{font-size:12px}
      .destino-nombre{font-size:14px;font-weight:700;margin-top:4px}
      .tabla-header{display:flex;background:#f0f0f0;border-bottom:2px solid #000;padding:6px 8px}
      .col-cod{width:80px;font-weight:700;font-size:11px}
      .col-prod{flex:1;font-weight:700;font-size:11px}
      .col-cant{width:80px;text-align:center;font-weight:700;font-size:11px}
      table{width:100%;border-collapse:collapse}
      .items-body{min-height:300px}
      .firma{border-top:2px solid #000;padding:16px;min-height:80px}
      .fecha-row{padding:8px 16px;border-top:1px solid #ccc;font-size:11px;color:#555}
    </style></head><body>
    <div class="remito">
      <div class="header">
        <div class="header-logo">
          <div style="font-size:22px;font-weight:900;color:#cc0000;letter-spacing:2px">LA CHACHA</div>
        </div>
        <div class="header-tipo">
          <div class="letra">R</div>
          <div class="cod">COD. ${EMPRESA.cod}</div>
        </div>
        <div class="header-titulo">
          <h1>REMITO</h1>
        </div>
      </div>

      <div class="datos">
        <div class="datos-left">
          <strong>Razón Social:</strong> ${EMPRESA.nombre}<br/>
          <strong>Domicilio Legal:</strong> ${EMPRESA.domicilio}<br/>
          <strong>Cod. Postal:</strong> ${EMPRESA.codPostal}<br/>
          ${EMPRESA.ciudad}<br/>
          <strong>Ing. Brutos:</strong> ${EMPRESA.ingBrutos}
        </div>
        <div class="datos-right">
          <strong>CUIT:</strong> ${EMPRESA.cuit}<br/>
          <strong>Inicio de Actividades:</strong> ${EMPRESA.inicio}<br/>
          <strong>Condición frente al IVA:</strong> ${EMPRESA.iva}<br/><br/>
          <strong>Tel:</strong> ${EMPRESA.tel}
        </div>
      </div>

      <div class="destino">
        <strong>Sucursal destino:</strong>
        <div class="destino-nombre">${sucursal.branch_name || sucursal.branch_code}</div>
      </div>

      <div class="tabla-header">
        <div class="col-cod">Código</div>
        <div class="col-prod">Producto</div>
        <div class="col-cant">Cant.</div>
      </div>

      <div class="items-body">
        <table>
          <tbody>${filas}</tbody>
        </table>
      </div>

      <div class="firma"></div>
      <div class="fecha-row">Fecha: ${fecha} · Generado por sistema KDS</div>
    </div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>
  `)
  ventana.document.close()
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function RemitosPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]             = useState('landing')
  const [modo, setModo]               = useState('pedidos')   // pedidos | retiros
  const [sucursalActiva, setSucActiva]= useState(null)
  const [datos, setDatos]             = useState([])
  const [retiros, setRetiros]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [generando, setGenerando]     = useState(null)
  const [toast, setToast]             = useState(null)
  const [fecha, setFecha]             = useState(fechaHoy)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargarPedidos = useCallback(async (f) => {
    setLoading(true)
    setSucActiva(null)
    try {
      const res = await fetch(`/api/remitos/pedidos?fecha=${f || fecha}`)
      if (!res.ok) throw new Error()
      setDatos(await res.json())
    } catch {
      mostrarToast('Error al cargar pedidos', 'err')
    } finally {
      setLoading(false)
    }
  }, [fecha])

  const cargarRetiros = useCallback(async (f) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/remitos/retiros?fecha=${f || fecha}`)
      if (!res.ok) throw new Error()
      setRetiros(await res.json())
    } catch {
      mostrarToast('Error al cargar retiros', 'err')
    } finally {
      setLoading(false)
    }
  }, [fecha])

  const irAPedidos = () => {
    setVista('pedidos')
    setModo('pedidos')
    cargarPedidos()
  }

  const irARetiros = () => {
    setVista('retiros')
    setModo('retiros')
    cargarRetiros()
  }

  const cambiarFecha = (nuevaFecha) => {
    setFecha(nuevaFecha)
    setSucActiva(null)
    if (modo === 'pedidos') cargarPedidos(nuevaFecha)
    else cargarRetiros(nuevaFecha)
  }

  // ── Generar remito y marcar como despachado ───────────────────────────────
  const generarRemito = async (suc) => {
    if (!confirm(`¿Generar remito para ${suc.branch_name || suc.branch_code} y marcar como despachado?`)) return

    setGenerando(suc.branch_code)
    try {
      const res = await fetch('/api/remitos/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id:    suc.order_id,
          branch_code: suc.branch_code,
          items: suc.items.map(i => ({
            item_id:    i.id,
            product_id: i.product_id,
            quantity:   i.confirmed_quantity,
            unit:       i.unit,
          })),
        }),
      })
      if (!res.ok) throw new Error()
      const { shipment_number } = await res.json()

      // Imprimir PDF
      imprimirRemito(suc, suc.items, fecha)

      mostrarToast(`Remito ${shipment_number} generado ✓`)
      cargarPedidos()
    } catch {
      mostrarToast('Error al generar remito', 'err')
    } finally {
      setGenerando(null)
    }
  }

  // ── Solo imprimir (si ya tiene remito) ────────────────────────────────────
  const soloImprimir = (suc) => imprimirRemito(suc, suc.items, fecha)

  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  const esModoRetiro = modo === 'retiros'

  return (
    <div style={{ ...s.page, background: esModoRetiro ? '#1a0a0a' : '#0f1c2e' }}>

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
            <button style={s.btnBack} onClick={() => { setVista('landing'); setModo('pedidos') }}>← Volver</button>
          )}
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={{ ...s.logoCyan, color: esModoRetiro ? '#f87171' : '#e2e8f0' }}>REMITOS</span>
          {esModoRetiro && (
            <span style={s.retiroBadge}>MODO RETIRO</span>
          )}
        </div>

        {/* Selector de fecha cuando está en una vista */}
        {vista !== 'landing' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ color: '#8899aa', fontSize: '12px' }}>Fecha:</label>
            <input
              type="date"
              value={fecha}
              onChange={e => cambiarFecha(e.target.value)}
              style={s.inputFecha}
            />
            <button style={s.btnRecargar} onClick={() => modo === 'pedidos' ? cargarPedidos() : cargarRetiros()}>
              ↻
            </button>
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
          <h2 style={s.titulo}>Sector Remitos</h2>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button style={s.btnLanding} onClick={irAPedidos}>
              <span style={{ fontSize: '2rem' }}>📄</span>
              <span>Pedidos confirmados</span>
              <span style={s.btnSub}>Generar y despachar remitos</span>
            </button>
            <button style={{ ...s.btnLanding, borderColor: '#f87171', background: '#1a0505' }} onClick={irARetiros}>
              <span style={{ fontSize: '2rem' }}>🔄</span>
              <span>Retiros express</span>
              <span style={s.btnSub}>Retiros sin pedido previo</span>
            </button>
          </div>
        </main>
      )}

      {/* ══ PEDIDOS CONFIRMADOS ══ */}
      {vista === 'pedidos' && (
        <main style={s.main}>
          <p style={s.subtitulo}>
            Items confirmados por Armado y Depósito listos para despachar · {fechaLegible(fecha)}
          </p>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando...</div>
          ) : datos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
              <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</p>
              <p>No hay pedidos listos para despachar en esta fecha</p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '20px', flex: 1 }}>

              {/* Lista de sucursales */}
              <div style={s.listaSuc}>
                {datos.map(suc => (
                  <button
                    key={suc.branch_code}
                    style={{
                      ...s.sucBtn,
                      borderColor: sucursalActiva?.branch_code === suc.branch_code
                        ? '#e2e8f0' : '#243550',
                      background: sucursalActiva?.branch_code === suc.branch_code
                        ? '#1e3050' : '#162236',
                    }}
                    onClick={() => setSucActiva(suc)}
                  >
                    <div style={s.sucBtnSigla}>{sigla(suc.branch_name)}</div>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                      <div style={{ color: 'white', fontWeight: '700', fontSize: '13px' }}>
                        {suc.branch_name || suc.branch_code}
                      </div>
                      <div style={{ color: '#8899aa', fontSize: '11px' }}>
                        {suc.items.length} item{suc.items.length !== 1 ? 's' : ''}
                        {suc.tiene_remito && (
                          <span style={{ marginLeft: '6px', color: '#4ade80' }}>· Remito generado</span>
                        )}
                      </div>
                    </div>
                    {suc.tiene_remito
                      ? <span style={{ color: '#4ade80', fontSize: '16px' }}>✓</span>
                      : <span style={{ color: '#fbbf24', fontSize: '12px' }}>Pendiente</span>
                    }
                  </button>
                ))}
              </div>

              {/* Detalle de la sucursal seleccionada */}
              {sucursalActiva ? (
                <div style={s.detallePanel}>
                  <div style={s.detalleTitulo}>
                    <div>
                      <div style={{ color: 'white', fontWeight: '700', fontSize: '15px' }}>
                        {sucursalActiva.branch_name || sucursalActiva.branch_code}
                      </div>
                      <div style={{ color: '#8899aa', fontSize: '12px' }}>
                        Entrega: {fechaLegible(sucursalActiva.delivery_date)} · {sucursalActiva.order_number}
                      </div>
                    </div>
                    {sucursalActiva.tiene_remito && (
                      <span style={s.remitoNumBadge}>{sucursalActiva.remito_number}</span>
                    )}
                  </div>

                  {/* Tabla de items */}
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    <table style={s.tabla}>
                      <thead>
                        <tr>
                          <th style={{ ...s.th, width: '80px' }}>Código</th>
                          <th style={s.th}>Producto</th>
                          <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Cantidad</th>
                          <th style={{ ...s.th, width: '60px' }}>Un.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sucursalActiva.items.map((item, i) => (
                          <tr key={item.id} style={{ background: i % 2 === 0 ? 'transparent' : '#0a1520' }}>
                            <td style={{ ...s.td, color: '#8899aa', fontSize: '11px' }}>{item.codigo_tango || '—'}</td>
                            <td style={s.td}>{item.product_name}</td>
                            <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#7dd3fc' }}>
                              {item.confirmed_quantity}
                            </td>
                            <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{item.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Acciones */}
                  <div style={s.detalleAcciones}>
                    {/* AFIP — deshabilitado, próximamente */}
                    <button
                      style={{ ...s.btnAfip, opacity: 0.4, cursor: 'not-allowed' }}
                      disabled
                      title="Integración AFIP — próximamente"
                    >
                      🏛️ Emisión oficial AFIP
                    </button>

                    {sucursalActiva.tiene_remito ? (
                      <button style={s.btnImprimir} onClick={() => soloImprimir(sucursalActiva)}>
                        🖨️ Reimprimir remito
                      </button>
                    ) : (
                      <button
                        style={{
                          ...s.btnGenerar,
                          opacity: generando === sucursalActiva.branch_code ? 0.6 : 1,
                          cursor:  generando === sucursalActiva.branch_code ? 'not-allowed' : 'pointer',
                        }}
                        disabled={generando === sucursalActiva.branch_code}
                        onClick={() => generarRemito(sucursalActiva)}
                      >
                        {generando === sucursalActiva.branch_code
                          ? 'Generando...'
                          : '📄 Generar remito e imprimir'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ ...s.detallePanel, alignItems: 'center', justifyContent: 'center' }}>
                  <p style={{ color: '#8899aa', fontSize: '14px' }}>
                    Seleccioná una sucursal para ver el detalle
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* ══ RETIROS EXPRESS ══ */}
      {vista === 'retiros' && (
        <main style={s.main}>
          <p style={{ ...s.subtitulo, color: '#fca5a5' }}>
            Retiros express del día · {fechaLegible(fecha)}
          </p>
          <p style={{ color: '#8899aa', fontSize: '12px', textAlign: 'center', marginBottom: '1.5rem' }}>
            Los retiros los inician las sucursales desde su pantalla
          </p>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando...</div>
          ) : retiros.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#8899aa' }}>
              <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔄</p>
              <p>Sin retiros express hoy</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {retiros.map(retiro => (
                <div key={retiro.id} style={{ ...s.sucCard, borderColor: '#991b1b' }}>
                  <div style={{ ...s.sucHeader, background: '#1a0505' }}>
                    <div style={{ ...s.sucSigla, background: '#f87171' }}>
                      {sigla(retiro.branch_code)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontWeight: '700' }}>{retiro.branch_code}</div>
                      <div style={{ color: '#8899aa', fontSize: '11px' }}>
                        {retiro.shipment_number} · {new Date(retiro.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <span style={{
                      fontSize: '11px', fontWeight: '600', padding: '3px 10px',
                      borderRadius: '10px',
                      background: retiro.status === 'DELIVERED' ? '#0d2518' : '#1a2a3a',
                      color:      retiro.status === 'DELIVERED' ? '#4ade80' : '#7dd3fc',
                    }}>
                      {retiro.status}
                    </span>
                  </div>
                  <table style={s.tabla}>
                    <thead>
                      <tr>
                        <th style={{ ...s.th, width: '80px' }}>Código</th>
                        <th style={s.th}>Producto</th>
                        <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retiro.items.map((item, i) => (
                        <tr key={i}>
                          <td style={{ ...s.td, color: '#8899aa', fontSize: '11px' }}>{item.codigo_tango || '—'}</td>
                          <td style={s.td}>{item.product_name}</td>
                          <td style={{ ...s.td, textAlign: 'center', fontWeight: '700', color: '#7dd3fc' }}>
                            {item.quantity_shipped} {item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s = {
  page:         { minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', transition: 'background .3s' },
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0, gap: '12px' },
  logoBlanco:   { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:     { fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  retiroBadge:  { background: '#7f1d1d', color: '#fca5a5', fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', border: '1px solid #dc2626' },
  userLabel:    { color: '#8899aa', fontSize: '13px' },
  btnSalir:     { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:      { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  inputFecha:   { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: 'white', fontSize: '13px', padding: '5px 10px', cursor: 'pointer' },
  btnRecargar:  { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '14px', padding: '4px 8px', cursor: 'pointer' },
  main:         { flex: 1, padding: '1.5rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:       { color: 'white', fontSize: '1.5rem', fontWeight: '700', textAlign: 'center' },
  subtitulo:    { color: '#7a9bb8', fontSize: '14px', textAlign: 'center', marginBottom: '1rem' },
  btnLanding:   { background: '#162236', border: '2px solid #e2e8f0', borderRadius: '12px', color: 'white', fontSize: '15px', fontWeight: '700', padding: '2rem 2.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '220px' },
  btnSub:       { color: '#8899aa', fontSize: '11px', fontWeight: '400' },

  listaSuc:     { display: 'flex', flexDirection: 'column', gap: '8px', width: '280px', flexShrink: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' },
  sucBtn:       { display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid', borderRadius: '10px', padding: '10px 14px', cursor: 'pointer', transition: 'all .15s' },
  sucBtnSigla:  { background: '#e2e8f0', color: '#0f1c2e', fontWeight: '900', fontSize: '14px', padding: '3px 8px', borderRadius: '5px', letterSpacing: '1px', flexShrink: 0 },

  detallePanel: { flex: 1, background: '#162236', border: '1px solid #243550', borderRadius: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  detalleTitulo:{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#0f1c2e', borderBottom: '1px solid #243550', flexShrink: 0 },
  remitoNumBadge:{ background: '#0d2518', color: '#4ade80', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '6px', border: '1px solid #166534' },
  detalleAcciones:{ display: 'flex', gap: '10px', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid #243550', flexShrink: 0 },

  btnAfip:      { background: 'none', border: '1px solid #374151', borderRadius: '7px', color: '#6b7280', fontSize: '12px', padding: '8px 16px', cursor: 'not-allowed' },
  btnImprimir:  { background: 'none', border: '1px solid #243550', borderRadius: '7px', color: '#7a9bb8', fontSize: '13px', fontWeight: '600', padding: '8px 18px', cursor: 'pointer' },
  btnGenerar:   { background: '#e2e8f0', border: 'none', borderRadius: '7px', color: '#0f1c2e', fontSize: '13px', fontWeight: '700', padding: '8px 20px' },

  tabla:        { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:           { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #243550' },
  td:           { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },

  sucCard:      { background: '#162236', border: '1px solid', borderRadius: '10px', overflow: 'hidden' },
  sucHeader:    { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid #243550' },
  sucSigla:     { color: '#0f1c2e', fontWeight: '900', fontSize: '18px', padding: '4px 10px', borderRadius: '6px', letterSpacing: '1px' },

  toast:        { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
