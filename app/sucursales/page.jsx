'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getFirestore, collection, getDocs, addDoc, query,
         where, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore'

// ─── Firebase config (nuevo proyecto) ────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAXELkDZdV1mc8GjbudhcwwJU5F1vq8qVc",
  authDomain:        "chacha-kds.firebaseapp.com",
  projectId:         "chacha-kds",
  storageBucket:     "chacha-kds.firebasestorage.app",
  messagingSenderId: "297572315003",
  appId:             "1:297572315003:web:212d0c16062bbeea0097de",
}

// Inicializar Firebase una sola vez
const firebaseApp = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApps()[0]
const db = getFirestore(firebaseApp)

// ─── Categorías del grid mapeadas por sub_condition ───────────────────────────
const CATEGORIAS = [
  // Producidos
  { id: 'horno',              label: 'Horno',          icon: '🥟' },
  { id: 'freir',              label: 'Para Freír',      icon: '🍳' },
  { id: 'hojaldre',           label: 'Hojaldre',        icon: '🥐' },
  { id: 'fraccionados',       label: 'Fraccionados',    icon: '📦' },
  { id: 'sandwiches',         label: 'Sandwiches',      icon: '🥪' },
  { id: 'copetin',            label: 'Copetín',         icon: '🫓' },
  { id: 'postres',            label: 'Postres',         icon: '🍮' },
  // Fábrica — con restricción horaria
  { id: 'fabrica',            label: 'Fábrica',         icon: '⚙️', esFabrica: true },
  // Bebidas
  { id: 'gaseosa',            label: 'Gaseosas',        icon: '🥤' },
  { id: 'cerveza',            label: 'Cervezas',        icon: '🍺' },
  { id: 'vinos',              label: 'Vinos',           icon: '🍷' },
  { id: 'jugos',              label: 'Jugos',           icon: '🧃' },
  { id: 'aguas',              label: 'Aguas',           icon: '💧' },
  // Insumos
  { id: 'envases',            label: 'Envases',         icon: '📫' },
  { id: 'consumibles',        label: 'Consumibles',     icon: '🧴' },
  { id: 'limpieza',           label: 'Limpieza',        icon: '🧹' },
  { id: 'etiqueta',           label: 'Etiquetas',       icon: '🏷️' },
  { id: 'elementos de trabajo', label: 'Elem. Trabajo', icon: '🔧' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esAntesDeCorte(hh = 14, mm = 30) {
  const ahora = new Date()
  return ahora.getHours() < hh || (ahora.getHours() === hh && ahora.getMinutes() < mm)
}

function hoyARstr() {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).split('/').reverse().join('-')
}

function buildPedidoId(sucursal) {
  const ahora = new Date()
  const pad = n => String(n).padStart(2, '0')
  const ts = `${ahora.getFullYear()}${pad(ahora.getMonth()+1)}${pad(ahora.getDate())}-${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `${sucursal}-${ts}-${rand}`
}

// ─── Cache local de productos (evita re-fetches) ──────────────────────────────
const cacheProductos = {}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function SucursalesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [modoRetiro, setModoRetiro]       = useState(false)
  const [catActiva, setCatActiva]         = useState(null)
  const [productos, setProductos]         = useState([])
  const [loadingProd, setLoadingProd]     = useState(false)
  const [carrito, setCarrito]             = useState([])
  const [modalCarrito, setModalCarrito]   = useState(false)
  const [modalUltimo, setModalUltimo]     = useState(false)
  const [ultimosPedidos, setUltimoPed]    = useState([])
  const [loadingUltimo, setLoadingUltimo] = useState(false)
  const [enviando, setEnviando]           = useState(false)
  const [toast, setToast]                 = useState(null)
  const lockRef = useRef(false)

  // Redirect si no tiene sesión válida
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])

  // ── Toast ─────────────────────────────────────────────────────────────────
  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Cargar productos de una categoría desde Firebase ─────────────────────
  const abrirCategoria = useCallback(async (cat) => {
    if (lockRef.current) return
    lockRef.current = true

    if (cat.esFabrica) {
      if (modoRetiro) {
        mostrarToast('No se puede pedir a Fábrica en modo Retiro.', 'err')
        lockRef.current = false
        return
      }
      if (!esAntesDeCorte(14, 30)) {
        mostrarToast('Pedido a Fábrica solo hasta las 14:30.', 'err')
        lockRef.current = false
        return
      }
      if (!confirm('ATENCIÓN: pedido directo a FÁBRICA (entrega mañana). ¿Continuar?')) {
        lockRef.current = false
        return
      }
    }

    setCatActiva(cat)
    setLoadingProd(true)

    try {
      // Usar cache si ya lo cargamos
      if (cacheProductos[cat.id]) {
        setProductos(cacheProductos[cat.id].map(p => ({ ...p, cantidad: 0 })))
        return
      }

      const q = query(
        collection(db, 'productos'),
        where('sub_condition', '==', cat.id),
        orderBy('nombre')
      )
      const snap = await getDocs(q)
      const lista = snap.docs.map(d => ({ ...d.data(), firestoreId: d.id, cantidad: 0 }))
      cacheProductos[cat.id] = lista.map(p => ({ ...p })) // guardar sin cantidad
      setProductos(lista)
    } catch (err) {
      console.error(err)
      mostrarToast('Error al cargar productos.', 'err')
      setCatActiva(null)
    } finally {
      setLoadingProd(false)
      setTimeout(() => { lockRef.current = false }, 300)
    }
  }, [modoRetiro])

  // ── Cantidad en modal ─────────────────────────────────────────────────────
  const setCantidad = (id, val) => {
    setProductos(prev => prev.map(p =>
      p.id === id ? { ...p, cantidad: Math.max(0, parseInt(val) || 0) } : p
    ))
  }

  // ── Agregar al carrito ────────────────────────────────────────────────────
  const agregarAlCarrito = () => {
    const nuevos = productos.filter(p => p.cantidad > 0)
    if (!nuevos.length) { mostrarToast('Ingresá al menos una cantidad.', 'err'); return }

    setCarrito(prev => {
      const copia = [...prev]
      nuevos.forEach(p => {
        const idx = copia.findIndex(x => x.id === p.id)
        if (idx >= 0) copia[idx].cantidad += p.cantidad
        else copia.push({ ...p })
      })
      return copia
    })
    setCatActiva(null)
    mostrarToast(`${nuevos.length} producto${nuevos.length > 1 ? 's' : ''} agregado${nuevos.length > 1 ? 's' : ''}.`)
  }

  const quitarDelCarrito = (id) => setCarrito(prev => prev.filter(x => x.id !== id))

  const setCantidadCarrito = (id, val) => {
    setCarrito(prev =>
      prev.map(p => p.id === id ? { ...p, cantidad: Math.max(0, parseInt(val) || 0) } : p)
          .filter(p => p.cantidad > 0)
    )
  }

  // ── Enviar pedido / retiro a Firebase ────────────────────────────────────
  const enviar = async () => {
    if (!carrito.length) { mostrarToast('El carrito está vacío.', 'err'); return }
    const tipo = modoRetiro ? 'RETIRO' : 'PEDIDO'
    if (!confirm(`¿Confirmar envío de ${tipo}?`)) return

    setEnviando(true)
    const sucursal = session.user.sector
    const ahora    = new Date()
    const fecha    = hoyARstr()
    const ordenId  = buildPedidoId(sucursal) + (modoRetiro ? '-RET' : '')

    // Separar items de fábrica del resto
    const fabricaItems = carrito.filter(p => p.sub_condition === 'fabrica')
    const normalItems  = carrito.filter(p => p.sub_condition !== 'fabrica')

    try {
      // Pedido normal
      if (normalItems.length) {
        await addDoc(collection(db, 'pedidos'), {
          ordenId,
          sucursal,
          tipo,
          fecha_pedido: fecha,
          creadoEn: serverTimestamp(),
          estado: 'PENDIENTE',
          items: normalItems.map(p => ({
            product_id:    p.id,
            nombre:        p.nombre,
            sub_condition: p.sub_condition,
            condition:     p.condition,
            cantidad:      p.cantidad,
            unidad:        p.unidad,
          }))
        })
      }

      // Pedido fábrica (colección separada, entrega día siguiente)
      if (fabricaItems.length) {
        if (!esAntesDeCorte(14, 30)) {
          mostrarToast('Items de Fábrica no enviados (pasó el corte de 14:30).', 'err')
        } else {
          const manana = new Date(ahora)
          manana.setDate(manana.getDate() + 1)
          const fechaEntrega = manana.toISOString().split('T')[0]

          await addDoc(collection(db, 'pedidos_fabrica'), {
            ordenId: ordenId + '-FAB',
            sucursal,
            tipo: 'PEDIDO_FABRICA',
            fecha_pedido:   fecha,
            fecha_entrega:  fechaEntrega,
            creadoEn:       serverTimestamp(),
            estado:         'PENDIENTE',
            items: fabricaItems.map(p => ({
              product_id:    p.id,
              nombre:        p.nombre,
              sub_condition: p.sub_condition,
              cantidad:      p.cantidad,
              unidad:        p.unidad,
            }))
          })
        }
      }

      mostrarToast(`${tipo} enviado correctamente ✓`)
      setCarrito([])
      setModalCarrito(false)
      if (modoRetiro) setModoRetiro(false)

    } catch (err) {
      console.error(err)
      mostrarToast('Error al enviar. Intentá de nuevo.', 'err')
    } finally {
      setEnviando(false)
    }
  }

  // ── Ver últimos pedidos de hoy ────────────────────────────────────────────
  const verUltimos = async () => {
    setLoadingUltimo(true)
    setModalUltimo(true)
    const sucursal = session.user.sector
    const fecha    = hoyARstr()

    try {
      const [snapPed, snapFab] = await Promise.all([
        getDocs(query(
          collection(db, 'pedidos'),
          where('sucursal', '==', sucursal),
          where('fecha_pedido', '==', fecha)
        )),
        getDocs(query(
          collection(db, 'pedidos_fabrica'),
          where('sucursal', '==', sucursal),
          where('fecha_pedido', '==', fecha)
        ))
      ])

      // Agrupar por producto sumando cantidades
      const mapa = new Map()
      ;[...snapPed.docs, ...snapFab.docs].forEach(doc => {
        const d = doc.data()
        ;(d.items || []).forEach(item => {
          const key = item.product_id
          if (mapa.has(key)) {
            mapa.get(key).cantidad += item.cantidad
          } else {
            mapa.set(key, { nombre: item.nombre, cantidad: item.cantidad, unidad: item.unidad })
          }
        })
      })

      setUltimoPed(
        Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
      )
    } catch (err) {
      console.error(err)
      mostrarToast('Error al cargar pedidos.', 'err')
      setModalUltimo(false)
    } finally {
      setLoadingUltimo(false)
    }
  }

  // ── Modo retiro ───────────────────────────────────────────────────────────
  const iniciarRetiro  = () => { setCarrito([]); setModoRetiro(true) }
  const cancelarRetiro = () => { setCarrito([]); setModoRetiro(false) }

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (status === 'loading') return (
    <div style={s.page}><p style={{ color: '#8899aa', margin: 'auto' }}>Cargando...</p></div>
  )

  const sucursalNombre = session?.user?.name || session?.user?.sector || '—'
  const totalItems     = carrito.reduce((sum, p) => sum + p.cantidad, 0)

  return (
    <div style={{ ...s.page, background: modoRetiro ? '#1a0a0a' : '#0f1c2e' }}>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          ...s.toast,
          background:   toast.tipo === 'err' ? '#7f1d1d' : '#14532d',
          borderColor:  toast.tipo === 'err' ? '#ef4444' : '#22c55e',
        }}>
          {toast.msg}
        </div>
      )}

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={s.logoBlanco}>AUSTRA </span>
          <span style={s.logoCyan}>KDS</span>
          {modoRetiro && <span style={s.retiroBadge}>MODO RETIRO</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={s.sucNombre}>{sucursalNombre}</span>
          <button style={s.btnSalir} onClick={() => signOut({ callbackUrl: '/' })}>Salir</button>
        </div>
      </header>

      {/* ── GRID DE CATEGORÍAS ── */}
      <main style={s.main}>
        <div style={s.grid}>
          {CATEGORIAS.map(cat => (
            <button
              key={cat.id}
              style={{
                ...s.catCard,
                borderColor: cat.esFabrica ? '#92400e' : '#243550',
                background:  cat.esFabrica ? '#1c1000' : '#162236',
              }}
              onClick={() => abrirCategoria(cat)}
            >
              <span style={{ fontSize: '1.75rem' }}>{cat.icon}</span>
              <span style={s.catLabel}>{cat.label}</span>
              {cat.esFabrica && (
                <span style={s.fabricaBadge}>hasta 14:30</span>
              )}
            </button>
          ))}
        </div>

        {/* ── BOTONES DE ACCIÓN ── */}
        <div style={s.acciones}>
          {!modoRetiro ? (
            <>
              <button style={s.btnPrimario} onClick={() => setModalCarrito(true)}>
                🛒 Revisar pedido
                {carrito.length > 0 && (
                  <span style={s.badge}>{totalItems}</span>
                )}
              </button>
              <button style={s.btnSecundario} onClick={verUltimos}>
                📋 Ver último pedido
              </button>
              <button
                style={{ ...s.btnSecundario, borderColor: '#991b1b', color: '#fca5a5' }}
                onClick={iniciarRetiro}
              >
                🔄 Retiro de mercadería
              </button>
            </>
          ) : (
            <>
              <button style={{ ...s.btnPrimario, background: '#dc2626' }} onClick={() => setModalCarrito(true)}>
                🔄 Revisar retiro
                {carrito.length > 0 && <span style={s.badge}>{totalItems}</span>}
              </button>
              <button
                style={{ ...s.btnSecundario, borderColor: '#374151', color: '#6b7280' }}
                onClick={cancelarRetiro}
              >
                ✕ Cancelar y volver
              </button>
            </>
          )}
        </div>
      </main>

      {/* ══════════════════════════════════════════════════════════════
          MODAL: Productos de la categoría
      ══════════════════════════════════════════════════════════════ */}
      {catActiva && (
        <div style={s.overlay} onClick={() => { setCatActiva(null); lockRef.current = false }}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitulo}>{catActiva.icon} {catActiva.label}</h2>
                {catActiva.esFabrica && (
                  <p style={{ color: '#fbbf24', fontSize: '12px', margin: '4px 0 0' }}>
                    ⚠️ Entrega el día siguiente · Solo hasta las 14:30
                  </p>
                )}
              </div>
              <button style={s.btnClose} onClick={() => { setCatActiva(null); lockRef.current = false }}>✕</button>
            </div>

            {loadingProd ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>
                Cargando productos...
              </div>
            ) : (
              <>
                <div style={{ overflowY: 'auto', maxHeight: '55vh' }}>
                  <table style={s.tabla}>
                    <thead>
                      <tr>
                        <th style={s.th}>Nombre</th>
                        <th style={{ ...s.th, width: '80px' }}>Unidad</th>
                        <th style={{ ...s.th, width: '110px', textAlign: 'center' }}>Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productos.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ ...s.td, color: '#8899aa', textAlign: 'center', padding: '2rem' }}>
                            Sin productos en esta categoría
                          </td>
                        </tr>
                      ) : productos.map(p => (
                        <tr
                          key={p.id}
                          style={{ background: p.cantidad > 0 ? '#0d2518' : 'transparent' }}
                        >
                          <td style={s.td}>{p.nombre}</td>
                          <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{p.unidad}</td>
                          <td style={{ ...s.td, textAlign: 'center' }}>
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              value={p.cantidad === 0 ? '' : p.cantidad}
                              placeholder="0"
                              onChange={e => setCantidad(p.id, e.target.value)}
                              onClick={e => e.target.select()}
                              style={s.inputCantidad}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={s.modalFooter}>
                  <button style={s.btnSecundario} onClick={() => { setCatActiva(null); lockRef.current = false }}>
                    Cancelar
                  </button>
                  <button style={s.btnPrimario} onClick={agregarAlCarrito}>
                    {modoRetiro ? '+ Agregar a Retiro' : '+ Agregar a Pedido'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          MODAL: Carrito
      ══════════════════════════════════════════════════════════════ */}
      {modalCarrito && (
        <div style={s.overlay} onClick={() => setModalCarrito(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitulo}>
                {modoRetiro ? '🔄 Resumen del Retiro' : '🛒 Resumen del Pedido'}
              </h2>
              <button style={s.btnClose} onClick={() => setModalCarrito(false)}>✕</button>
            </div>

            {carrito.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#8899aa' }}>
                El {modoRetiro ? 'retiro' : 'carrito'} está vacío
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '55vh' }}>
                <table style={s.tabla}>
                  <thead>
                    <tr>
                      <th style={s.th}>Nombre</th>
                      <th style={{ ...s.th, width: '80px' }}>Unidad</th>
                      <th style={{ ...s.th, width: '100px', textAlign: 'center' }}>Cantidad</th>
                      <th style={{ ...s.th, width: '50px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {carrito.map(p => (
                      <tr key={p.id}>
                        <td style={s.td}>{p.nombre}</td>
                        <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{p.unidad}</td>
                        <td style={{ ...s.td, textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            value={p.cantidad}
                            onChange={e => setCantidadCarrito(p.id, e.target.value)}
                            onClick={e => e.target.select()}
                            style={s.inputCantidad}
                          />
                        </td>
                        <td style={s.td}>
                          <button style={s.btnEliminar} onClick={() => quitarDelCarrito(p.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={s.modalFooter}>
              <button style={s.btnSecundario} onClick={() => setModalCarrito(false)}>
                Seguir cargando
              </button>
              <button
                style={{
                  ...s.btnPrimario,
                  background: enviando ? '#1d2f47' : (modoRetiro ? '#dc2626' : '#2196f3'),
                  opacity: (enviando || !carrito.length) ? 0.6 : 1,
                  cursor: (enviando || !carrito.length) ? 'not-allowed' : 'pointer',
                }}
                onClick={enviar}
                disabled={enviando || !carrito.length}
              >
                {enviando
                  ? 'Enviando...'
                  : modoRetiro ? '🔄 Confirmar Retiro' : '✓ Enviar Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          MODAL: Último pedido del día
      ══════════════════════════════════════════════════════════════ */}
      {modalUltimo && (
        <div style={s.overlay} onClick={() => setModalUltimo(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitulo}>📋 Pedidos de hoy</h2>
                <p style={{ color: '#8899aa', fontSize: '12px', margin: '4px 0 0' }}>
                  {sucursalNombre} · {hoyARstr()}
                </p>
              </div>
              <button style={s.btnClose} onClick={() => setModalUltimo(false)}>✕</button>
            </div>

            {loadingUltimo ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#8899aa' }}>
                Cargando...
              </div>
            ) : ultimosPedidos.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#8899aa' }}>
                Sin pedidos hoy
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
                <table style={s.tabla}>
                  <thead>
                    <tr>
                      <th style={s.th}>Nombre</th>
                      <th style={{ ...s.th, width: '90px', textAlign: 'center' }}>Cantidad</th>
                      <th style={{ ...s.th, width: '70px' }}>Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ultimosPedidos.map((p, i) => (
                      <tr key={i}>
                        <td style={s.td}>{p.nombre}</td>
                        <td style={{ ...s.td, textAlign: 'center', fontWeight: '600', color: '#7dd3fc' }}>
                          {p.cantidad}
                        </td>
                        <td style={{ ...s.td, color: '#8899aa', fontSize: '12px' }}>{p.unidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={s.modalFooter}>
              <button style={s.btnSecundario} onClick={() => setModalUltimo(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Sistema de estilos ───────────────────────────────────────────────────────
const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, sans-serif',
    transition: 'background .4s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 24px',
    borderBottom: '1px solid #1e3050',
    background: '#0d1a2a',
    flexShrink: 0,
  },
  logoBlanco: { color: 'white', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  logoCyan:   { color: '#2196f3', fontSize: '1rem', fontWeight: '700', letterSpacing: '.06em' },
  retiroBadge: {
    background: '#7f1d1d', color: '#fca5a5',
    fontSize: '10px', fontWeight: '700', letterSpacing: '.08em',
    padding: '2px 8px', borderRadius: '4px', border: '1px solid #dc2626',
  },
  sucNombre: { color: '#8899aa', fontSize: '13px' },
  btnSalir: {
    background: 'none', border: '1px solid #243550', borderRadius: '5px',
    color: '#8899aa', fontSize: '12px', padding: '4px 10px', cursor: 'pointer',
  },
  main: {
    flex: 1,
    padding: '1.5rem 2rem',
    maxWidth: '960px',
    width: '100%',
    margin: '0 auto',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '10px',
    marginBottom: '1.5rem',
  },
  catCard: {
    border: '1px solid',
    borderRadius: '10px',
    padding: '1rem .5rem',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    transition: 'opacity .15s, transform .1s',
  },
  catLabel: {
    color: '#7a9bb8', fontSize: '10px', fontWeight: '600',
    letterSpacing: '.04em', textAlign: 'center', lineHeight: 1.3,
  },
  fabricaBadge: {
    background: '#451a03', color: '#fbbf24', fontSize: '9px',
    padding: '1px 5px', borderRadius: '3px', border: '1px solid #92400e',
  },
  acciones: {
    display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap',
  },
  btnPrimario: {
    background: '#2196f3', border: 'none', borderRadius: '7px',
    color: 'white', fontSize: '13px', fontWeight: '700',
    padding: '10px 20px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '.04em',
  },
  btnSecundario: {
    background: 'none', border: '1px solid #243550', borderRadius: '7px',
    color: '#7a9bb8', fontSize: '13px', fontWeight: '600',
    padding: '10px 20px', cursor: 'pointer', letterSpacing: '.04em',
  },
  badge: {
    background: 'white', color: '#2196f3', borderRadius: '50%',
    width: '20px', height: '20px', fontSize: '11px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, padding: '1rem',
  },
  modal: {
    background: '#162236', border: '1px solid #243550', borderRadius: '12px',
    width: '100%', maxWidth: '700px', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '1.25rem 1.25rem .75rem', borderBottom: '1px solid #243550',
    flexShrink: 0,
  },
  modalTitulo: {
    color: 'white', fontSize: '1rem', fontWeight: '700', margin: 0, letterSpacing: '.04em',
  },
  modalFooter: {
    padding: '1rem 1.25rem', borderTop: '1px solid #243550',
    display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0,
  },
  btnClose: {
    background: 'none', border: 'none', color: '#8899aa',
    fontSize: '18px', cursor: 'pointer', padding: '0 4px', lineHeight: 1,
  },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    background: '#0f1c2e', color: '#4a7fa5', padding: '8px 12px',
    textAlign: 'left', fontSize: '11px', fontWeight: '700',
    letterSpacing: '.06em', textTransform: 'uppercase',
    borderBottom: '1px solid #243550', position: 'sticky', top: 0,
  },
  td: { color: '#c8d8e8', padding: '8px 12px', borderBottom: '1px solid #1a2a3a' },
  inputCantidad: {
    background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px',
    color: 'white', fontSize: '15px', fontWeight: '600',
    padding: '5px 8px', width: '75px', textAlign: 'center', outline: 'none',
  },
  btnEliminar: {
    background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px',
  },
  toast: {
    position: 'fixed', bottom: '24px', right: '24px',
    border: '1px solid', borderRadius: '8px', color: 'white',
    fontSize: '13px', fontWeight: '600', padding: '12px 20px',
    zIndex: 200, letterSpacing: '.04em', boxShadow: '0 4px 20px rgba(0,0,0,.4)',
  },
}
