'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'

function horaActual() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date())
}

function fechaHoy() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date())
}

// Color por sector
const SECTOR_COLORS = {
  COCINA:      { border: '#ef4444', label: '#fca5a5', bg: '#1a0505' },
  FABRICA:     { border: '#a78bfa', label: '#c4b5fd', bg: '#0a0515' },
  ARMADO:      { border: '#F4C430', label: '#fde68a', bg: '#1a1000' },
  FRACCIONADO: { border: '#34d399', label: '#6ee7b7', bg: '#001a0a' },
  DEPOSITO:    { border: '#60a5fa', label: '#93c5fd', bg: '#000f1a' },
  default:     { border: '#8899aa', label: '#c8d8e8', bg: '#162236' },
}

function getSectorColor(code) {
  return SECTOR_COLORS[code] || SECTOR_COLORS.default
}

export default function StockPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [vista, setVista]           = useState('sectores')  // sectores | conteo | resumen
  const [sectores, setSectores]     = useState([])
  const [sectorActivo, setSectorAct]= useState(null)
  const [productos, setProductos]   = useState([])
  const [cantidades, setCantidades] = useState({})          // { product_id: cantidad }
  const [loadingSec, setLoadingSec] = useState(true)
  const [loadingProd, setLoadingProd] = useState(false)
  const [guardando, setGuardando]   = useState(false)
  const [toast, setToast]           = useState(null)
  const inputRefs = useRef({})

  // ── Conversor de unidades (persiste en localStorage por product_id) ─────────
  const UNIDADES_CONTEO = ['Lata', 'Caja', 'Pack', 'Unidad', 'Bolsa']
  const [conversor, setConversor] = useState({})
  // conversor = { [product_id]: { activo: bool, unidad: string, peso: number } }

  // Cargar conversor desde localStorage al entrar al sector
  const cargarConversor = (prods) => {
    const saved = {}
    prods.forEach(p => {
      const key = `conv_${p.product_id}`
      try {
        const v = localStorage.getItem(key)
        saved[p.product_id] = v ? JSON.parse(v) : { activo: false, unidad: 'Lata', peso: '' }
      } catch {
        saved[p.product_id] = { activo: false, unidad: 'Lata', peso: '' }
      }
    })
    setConversor(saved)
    return saved
  }

  const updateConversor = (product_id, changes) => {
    setConversor(prev => {
      const updated = { ...prev, [product_id]: { ...prev[product_id], ...changes } }
      // Persistir en localStorage
      try { localStorage.setItem(`conv_${product_id}`, JSON.stringify(updated[product_id])) } catch {}
      return updated
    })
  }

  // Calcular KG a partir del conversor. Si el producto tiene conversion_factor
  // cargado en el catálogo (admin), ese es el peso oficial y pisa cualquier
  // valor tipeado a mano — evita que cada tablet tenga un peso de envase distinto.
  const calcularKG = (prod, cantUnidades) => {
    const c = conversor[prod.product_id]
    if (!c?.activo || cantUnidades === '' || cantUnidades === undefined) return cantUnidades
    const peso = prod.conversion_factor || c.peso
    // Conversor activo pero sin peso (ni oficial ni tipeado a mano): no hay forma
    // de convertir. Devolver undefined en vez de la cantidad cruda — así el
    // llamador puede detectar la conversión incompleta en vez de guardarla
    // silenciosamente como si "cantidad de artículos" fuera KG.
    if (!peso) return undefined
    return Math.round(Number(cantUnidades) * Number(peso) * 1000) / 1000
  }

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Cargar sectores disponibles ───────────────────────────────────────────
  const cargarSectores = useCallback(async () => {
    setLoadingSec(true)
    try {
      const res = await fetch('/api/stock/config')
      if (!res.ok) throw new Error()
      setSectores(await res.json())
    } catch {
      mostrarToast('Error al cargar sectores', 'err')
    } finally {
      setLoadingSec(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') cargarSectores()
  }, [status, cargarSectores])

  // ── Entrar a un sector para hacer el conteo ───────────────────────────────
  const entrarSector = async (sector) => {
    setSectorAct(sector)
    setLoadingProd(true)
    setVista('conteo')
    setCantidades({})
    try {
      const res = await fetch(`/api/stock/config?sector_id=${sector.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setProductos(data)
      const conv = cargarConversor(data)
      // Pre-cargar con el último conteo si existe — salvo que el conversor esté
      // activo para ese producto, en cuyo caso el campo es "cantidad de artículos"
      // y precargar el último total en KG rompería el cálculo (KG_viejo × peso).
      const initCant = {}
      data.forEach(p => {
        initCant[p.product_id] = conv[p.product_id]?.activo
          ? ''
          : (p.ultimo_conteo !== null ? p.ultimo_conteo : '')
      })
      setCantidades(initCant)
    } catch {
      mostrarToast('Error al cargar productos', 'err')
      setVista('sectores')
    } finally {
      setLoadingProd(false)
    }
  }

  // ── Navegar con Enter entre inputs ────────────────────────────────────────
  const handleKeyDown = (e, productId, index) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const nextProduct = productos[index + 1]
      if (nextProduct && inputRefs.current[nextProduct.product_id]) {
        inputRefs.current[nextProduct.product_id].focus()
        inputRefs.current[nextProduct.product_id].select()
      }
    }
  }

  // ── Confirmar conteo ──────────────────────────────────────────────────────
  const confirmarConteo = async () => {
    const contados = productos.filter(
      p => cantidades[p.product_id] !== '' && cantidades[p.product_id] !== undefined
    )

    // Conversor activo pero sin peso cargado (ni oficial ni tipeado a mano):
    // calcularKG no puede convertir — bloquear el envío en vez de guardar la
    // cantidad de artículos como si fuera KG.
    const incompletos = contados.filter(p => calcularKG(p, cantidades[p.product_id]) === undefined)
    if (incompletos.length > 0) {
      mostrarToast(
        `Falta el peso para convertir: ${incompletos.map(p => p.product_name).join(', ')}`,
        'err'
      )
      return
    }

    const conteos = contados.map(p => ({
      product_id: p.product_id,
      quantity:   Number(calcularKG(p, cantidades[p.product_id])),
      // Si el conversor está activo, lo que se tipeó es "cantidad de envases",
      // no KG — se manda tal cual para que quede guardada y visible en admin,
      // sin depender de que el producto tenga conversion_factor oficial.
      quantity_units: conversor[p.product_id]?.activo ? Number(cantidades[p.product_id]) : null,
      unit:       p.base_unit,
    }))

    if (!conteos.length) {
      mostrarToast('Ingresá al menos una cantidad', 'err')
      return
    }

    const sinContar = productos.filter(
      p => cantidades[p.product_id] === '' || cantidades[p.product_id] === undefined
    )

    if (sinContar.length > 0) {
      if (!confirm(`Hay ${sinContar.length} producto${sinContar.length > 1 ? 's' : ''} sin contar. ¿Confirmás igual?`)) return
    }

    setGuardando(true)
    try {
      const res = await fetch('/api/stock/conteo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector_id: sectorActivo.id, conteos }),
      })
      if (!res.ok) throw new Error()
      setVista('resumen')
    } catch {
      mostrarToast('Error al guardar conteo', 'err')
    } finally {
      setGuardando(false)
    }
  }

  // ── Totales del conteo actual ─────────────────────────────────────────────
  const totalContados = productos.filter(
    p => cantidades[p.product_id] !== '' && cantidades[p.product_id] !== undefined
  ).length
  const totalProductos = productos.length

  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  const colSector = sectorActivo ? getSectorColor(sectorActivo.code) : SECTOR_COLORS.default

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
          {vista !== 'sectores' && (
            <button style={s.btnBack} onClick={() => setVista('sectores')}>← Sectores</button>
          )}
          <span style={s.logoBlanco}>AUSTRA</span>
          <span style={s.logoCyan}>STOCK</span>
          {sectorActivo && vista !== 'sectores' && (
            <span style={{ ...s.sectorBadge, background: colSector.bg, borderColor: colSector.border, color: colSector.label }}>
              {sectorActivo.name}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#8899aa', fontSize: '12px' }}>{fechaHoy()}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ══ PANTALLA DE SECTORES ══ */}
      {vista === 'sectores' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={s.titulo}>Conteo de stock</h2>
            <p style={s.subtitulo}>Elegí el sector a contar</p>
          </div>

          {loadingSec ? (
            <p style={{ color: '#8899aa' }}>Cargando sectores...</p>
          ) : sectores.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8899aa' }}>
              <p>No hay sectores configurados para conteo.</p>
              <p style={{ fontSize: '12px', marginTop: '8px' }}>
                Configurá los productos a contar en stock_count_config.
              </p>
            </div>
          ) : (
            <div style={s.gridSectores}>
              {sectores.map(sec => {
                const col = getSectorColor(sec.code)
                return (
                  <button
                    key={sec.id}
                    style={{ ...s.btnSector, borderColor: col.border, background: col.bg }}
                    onClick={() => entrarSector(sec)}
                  >
                    <span style={{ fontSize: '2.5rem' }}>
                      {sec.code === 'COCINA' ? '🍳' :
                       sec.code === 'FABRICA' ? '⚙️' :
                       sec.code === 'ARMADO' ? '🥟' :
                       sec.code === 'FRACCIONADO' ? '📦' :
                       sec.code === 'DEPOSITO' ? '🏪' : '📋'}
                    </span>
                    <span style={{ color: col.label, fontWeight: '700', fontSize: '16px' }}>
                      {sec.name}
                    </span>
                    <span style={{ color: '#8899aa', fontSize: '12px' }}>
                      {sec.productos} producto{sec.productos !== 1 ? 's' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </main>
      )}

      {/* ══ CONTEO DEL SECTOR ══ */}
      {vista === 'conteo' && (
        <main style={s.main}>

          {/* Barra de progreso */}
          <div style={s.progresoBarra}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ color: '#8899aa', fontSize: '12px' }}>Progreso del conteo</span>
              <span style={{ color: 'white', fontWeight: '700', fontSize: '13px' }}>
                {totalContados} / {totalProductos}
              </span>
            </div>
            <div style={s.barraFondo}>
              <div style={{
                ...s.barraRelleno,
                width: `${totalProductos > 0 ? (totalContados / totalProductos) * 100 : 0}%`,
                background: colSector.border,
              }} />
            </div>
          </div>

          {loadingProd ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando productos...</div>
          ) : (
            <>
              {/* Lista de productos — optimizada para tablet */}
              <div style={s.listaProductos}>
                {productos.map((prod, index) => {
                  const cant = cantidades[prod.product_id]
                  const tieneValor = cant !== '' && cant !== undefined
                  // ultimo_conteo siempre está en KG/base_unit — cuando el conversor está
                  // activo, "cant" es cantidad de artículos, así que hay que comparar
                  // contra el KG equivalente, no contra el valor crudo tipeado.
                  const kgEquivalente = tieneValor ? calcularKG(prod, cant) : undefined
                  const cambioDesdeUltimo = tieneValor && prod.ultimo_conteo !== null &&
                    kgEquivalente !== undefined && Number(kgEquivalente) !== prod.ultimo_conteo

                  return (
                    <div
                      key={prod.product_id}
                      style={{
                        ...s.filaProducto,
                        background: tieneValor ? '#0d1f14' : '#162236',
                        borderColor: tieneValor ? colSector.border : '#243550',
                      }}
                    >
                      {/* Nombre y datos */}
                      <div style={s.productoInfo}>
                        <div style={s.productoNombre}>{prod.product_name}</div>
                        <div style={s.productoMeta}>
                          {prod.base_unit}
                          {prod.ultimo_conteo !== null && (
                            <span style={{ marginLeft: '8px', color: '#8899aa' }}>
                              · Último: {prod.ultimo_conteo} {prod.base_unit}
                            </span>
                          )}
                          {cambioDesdeUltimo && (
                            <span style={{
                              marginLeft: '8px', fontSize: '10px', fontWeight: '700',
                              color: Number(kgEquivalente) > prod.ultimo_conteo ? '#4ade80' : '#f87171'
                            }}>
                              {Number(kgEquivalente) > prod.ultimo_conteo ? '▲' : '▼'}
                              {Math.abs(Number(kgEquivalente) - prod.ultimo_conteo)} vs ayer
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Input de cantidad + conversor */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                        {/* Fila principal: input + unidad */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {conversor[prod.product_id]?.activo && (
                            <span style={{ color: '#4ade80', fontSize: '11px', fontWeight: '600' }}>Cant. artículos</span>
                          )}
                          <input
                            ref={el => inputRefs.current[prod.product_id] = el}
                            type="number"
                            min="0"
                            step="0.5"
                            inputMode="decimal"
                            placeholder={conversor[prod.product_id]?.activo ? 'cant.' : '—'}
                            value={cant === '' ? '' : cant}
                            onChange={e => {
                              const val = e.target.value
                              setCantidades(prev => ({
                                ...prev,
                                [prod.product_id]: val === '' ? '' : Math.max(0, parseFloat(val) || 0)
                              }))
                            }}
                            onFocus={e => e.target.select()}
                            onKeyDown={e => handleKeyDown(e, prod.product_id, index)}
                            style={{
                              ...s.inputCantidad,
                              borderColor: tieneValor ? colSector.border : '#243550',
                              color: tieneValor ? 'white' : '#8899aa',
                            }}
                          />
                          {/* Botón conversor */}
                          <button
                            onClick={() => {
                              const activarNuevo = !conversor[prod.product_id]?.activo
                              updateConversor(prod.product_id, { activo: activarNuevo })
                              // Al activar, limpiar el campo: pasa a significar "cantidad
                              // de artículos", no el KG total que pudiera tener cargado.
                              if (activarNuevo) {
                                setCantidades(prev => ({ ...prev, [prod.product_id]: '' }))
                              }
                            }}
                            style={{
                              background: conversor[prod.product_id]?.activo ? '#1a3a1a' : '#162236',
                              border: `1px solid ${conversor[prod.product_id]?.activo ? '#22c55e' : '#243550'}`,
                              borderRadius: '6px', color: conversor[prod.product_id]?.activo ? '#4ade80' : '#8899aa',
                              fontSize: '13px', padding: '6px 10px', cursor: 'pointer', flexShrink: 0,
                            }}
                            title="Convertir desde otra unidad"
                          >⇄</button>
                        </div>

                        {/* Panel conversor — se muestra si está activo */}
                        {conversor[prod.product_id]?.activo && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#0d1f14', border: '1px solid #22c55e', borderRadius: '8px', padding: '6px 10px' }}>
                            {prod.conversion_factor ? (
                              // Factor oficial cargado en el catálogo — solo lectura, no se tipea a mano
                              <>
                                <span style={{ color: '#8899aa', fontSize: '11px' }}>1 unidad =</span>
                                <span style={{ color: 'white', fontSize: '12px', fontWeight: '700' }}>{prod.conversion_factor}</span>
                                <span style={{ color: '#8899aa', fontSize: '11px' }}>{prod.base_unit}</span>
                              </>
                            ) : (
                              <>
                                <select
                                  value={conversor[prod.product_id]?.unidad || 'Lata'}
                                  onChange={e => updateConversor(prod.product_id, { unidad: e.target.value })}
                                  style={{ background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: '#c8d8e8', fontSize: '12px', padding: '3px 6px', cursor: 'pointer' }}
                                >
                                  {UNIDADES_CONTEO.map(u => <option key={u}>{u}</option>)}
                                </select>
                                <span style={{ color: '#8899aa', fontSize: '11px' }}>=</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  placeholder="kg"
                                  value={conversor[prod.product_id]?.peso || ''}
                                  onChange={e => updateConversor(prod.product_id, { peso: e.target.value })}
                                  style={{ background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '12px', fontWeight: '600', padding: '3px 6px', width: '55px', textAlign: 'center', outline: 'none' }}
                                />
                                <span style={{ color: '#8899aa', fontSize: '11px' }}>kg</span>
                              </>
                            )}
                            {tieneValor && (prod.conversion_factor || conversor[prod.product_id]?.peso) && (
                              <span style={{ color: '#4ade80', fontSize: '12px', fontWeight: '700', marginLeft: '4px' }}>
                                = {calcularKG(prod, cant)} {prod.base_unit}
                              </span>
                            )}
                          </div>
                        )}

                        {/* KG label cuando no hay conversor */}
                        {tieneValor && !conversor[prod.product_id]?.activo && (
                          <span style={{ color: colSector.label, fontSize: '12px' }}>
                            {prod.base_unit}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Botón confirmar fijo abajo */}
              <div style={s.accionesConteo}>
                <div style={{ color: '#8899aa', fontSize: '12px' }}>
                  {totalProductos - totalContados > 0
                    ? `${totalProductos - totalContados} sin contar`
                    : '✓ Todos contados'}
                </div>
                <button
                  style={{
                    ...s.btnConfirmar,
                    background: colSector.border,
                    color: colSector.bg === '#1a0505' ? 'white' : '#0f1c2e',
                    opacity: guardando ? 0.6 : 1,
                    cursor: guardando ? 'not-allowed' : 'pointer',
                  }}
                  onClick={confirmarConteo}
                  disabled={guardando}
                >
                  {guardando ? 'Guardando...' : `✓ Confirmar conteo (${totalContados})`}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* ══ RESUMEN POST-CONTEO ══ */}
      {vista === 'resumen' && (
        <main style={{ ...s.main, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '24px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>✓</div>
            <h2 style={{ ...s.titulo, color: colSector.label }}>
              Conteo guardado
            </h2>
            <p style={s.subtitulo}>
              {sectorActivo?.name} · {fechaHoy()} · {horaActual()}
            </p>
          </div>

          {/* Resumen de lo que se contó */}
          <div style={{ background: '#162236', border: `1px solid ${colSector.border}`, borderRadius: '12px', padding: '16px', width: '100%', maxWidth: '500px' }}>
            <p style={{ color: colSector.label, fontWeight: '700', fontSize: '13px', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Resumen del conteo
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
              <div>
                <div style={{ color: 'white', fontWeight: '700', fontSize: '28px' }}>{totalContados}</div>
                <div style={{ color: '#8899aa', fontSize: '11px' }}>contados</div>
              </div>
              <div>
                <div style={{ color: '#f87171', fontWeight: '700', fontSize: '28px' }}>
                  {totalProductos - totalContados}
                </div>
                <div style={{ color: '#8899aa', fontSize: '11px' }}>sin contar</div>
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: '700', fontSize: '28px' }}>{totalProductos}</div>
                <div style={{ color: '#8899aa', fontSize: '11px' }}>total</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              style={s.btnVolverSectores}
              onClick={() => { setVista('sectores'); setSectorAct(null); setProductos([]) }}
            >
              Contar otro sector
            </button>
            <button
              style={{ ...s.btnVolverSectores, borderColor: colSector.border, color: colSector.label }}
              onClick={() => entrarSector(sectorActivo)}
            >
              Rehacer este sector
            </button>
          </div>
        </main>
      )}
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const s = {
  page:           { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0f1c2e', fontFamily: 'system-ui, sans-serif' },
  header:         { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #1e3050', background: '#0d1a2a', flexShrink: 0 },
  logoBlanco:     { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:       { color: '#7dd3fc', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  sectorBadge:    { fontSize: '11px', fontWeight: '700', padding: '2px 10px', borderRadius: '10px', border: '1px solid' },
  btnSalir:       { background: 'none', border: '1px solid #243550', borderRadius: '5px', color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer' },
  btnBack:        { background: 'none', border: '1px solid #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '13px', padding: '5px 12px', cursor: 'pointer' },
  main:           { flex: 1, padding: '1.5rem', maxWidth: '700px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:         { color: 'white', fontSize: '1.5rem', fontWeight: '700' },
  subtitulo:      { color: '#8899aa', fontSize: '14px', marginTop: '4px' },

  gridSectores:   { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '100%', maxWidth: '500px' },
  btnSector:      { border: '2px solid', borderRadius: '14px', padding: '2rem 1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'opacity .15s' },

  progresoBarra:  { marginBottom: '1rem', flexShrink: 0 },
  barraFondo:     { background: '#162236', borderRadius: '4px', height: '6px', overflow: 'hidden' },
  barraRelleno:   { height: '100%', borderRadius: '4px', transition: 'width .3s' },

  listaProductos: { display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', paddingBottom: '80px' },
  filaProducto:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid', borderRadius: '10px', padding: '12px 16px', gap: '12px', transition: 'all .15s' },
  productoInfo:   { flex: 1, minWidth: 0 },
  productoNombre: { color: 'white', fontWeight: '600', fontSize: '14px', lineHeight: 1.3 },
  productoMeta:   { color: '#8899aa', fontSize: '11px', marginTop: '2px' },

  // Input grande para tablet — fácil de tipear parado
  inputCantidad:  {
    background: '#0f1c2e', border: '2px solid', borderRadius: '8px',
    color: 'white', fontSize: '20px', fontWeight: '700',
    padding: '8px 12px', width: '90px', textAlign: 'center', outline: 'none',
    WebkitAppearance: 'none',
  },

  accionesConteo: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', background: '#0d1a2a',
    borderTop: '1px solid #1e3050', gap: '12px', zIndex: 10,
  },
  btnConfirmar:   { border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '700', padding: '12px 28px', flexShrink: 0 },

  btnVolverSectores: { background: 'none', border: '1px solid #243550', borderRadius: '8px', color: '#7a9bb8', fontSize: '14px', fontWeight: '600', padding: '12px 24px', cursor: 'pointer' },

  toast: { position: 'fixed', bottom: '80px', right: '20px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '10px 18px', zIndex: 200 },
}
