'use client'
import { useState, useEffect, useCallback } from 'react'

function fechaHoyAR() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function nuevoInsumo() {
  return {
    _key: Math.random().toString(36).slice(2),
    product_id: '', quantity: '', unit: 'KG', brand: '', lot_code: '', expires_at: '',
  }
}

// Pantalla de "Producción del día": reemplaza la planilla de papel RC-7397-2.
// Se usa igual en Fábrica, Armado y Fraccionado — solo cambia sectorCode/sectorLabel/apiPath.
export default function ProduccionDiaria({ sectorCode, sectorLabel, apiPath }) {
  const [fecha, setFecha]                     = useState(fechaHoyAR())
  const [loading, setLoading]                 = useState(false)
  const [guardando, setGuardando]             = useState(false)
  const [toast, setToast]                     = useState(null)
  const [notes, setNotes]                     = useState('')
  const [productosSector, setProductosSector] = useState([])
  const [productosInsumo, setProductosInsumo] = useState([])
  const [insumos, setInsumos]                 = useState([nuevoInsumo()])
  const [producido, setProducido]             = useState({}) // { product_id: cantidad }

  const mostrarToast = (msg, tipo = 'ok') => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  const cargar = useCallback(async (f) => {
    setLoading(true)
    try {
      const res = await fetch(`${apiPath}?fecha=${f}`)
      if (!res.ok) throw new Error()
      const data = await res.json()

      setProductosSector(data.productos_sector || [])
      setProductosInsumo(data.productos_insumo || [])
      setNotes(data.notes || '')

      setInsumos(
        (data.insumos || []).length
          ? data.insumos.map(i => ({
              _key: i.id,
              product_id: i.product_id, quantity: String(i.quantity),
              unit: i.unit, brand: i.brand || '', lot_code: i.lot_code || '',
              expires_at: i.expires_at || '',
            }))
          : [nuevoInsumo()]
      )

      const prod = {}
      ;(data.producido || []).forEach(o => { prod[o.product_id] = String(o.quantity) })
      setProducido(prod)
    } catch {
      mostrarToast('Error al cargar la producción del día', 'err')
    } finally {
      setLoading(false)
    }
  }, [apiPath])

  useEffect(() => { cargar(fecha) }, [fecha, cargar])

  const cambiarInsumo = (key, campo, valor) => {
    setInsumos(prev => prev.map(row => row._key === key ? { ...row, [campo]: valor } : row))
  }

  const agregarInsumo = () => setInsumos(prev => [...prev, nuevoInsumo()])

  const quitarInsumo = (key) => {
    setInsumos(prev => {
      const resto = prev.filter(row => row._key !== key)
      return resto.length ? resto : [nuevoInsumo()]
    })
  }

  const cambiarProducido = (productId, valor) => {
    setProducido(prev => ({ ...prev, [productId]: valor }))
  }

  const guardar = async () => {
    const insumosLimpios = insumos
      .filter(i => i.product_id && Number(i.quantity) > 0)
      .map(i => ({
        product_id: i.product_id, quantity: Number(i.quantity), unit: i.unit || 'KG',
        brand: i.brand || null, lot_code: i.lot_code || null, expires_at: i.expires_at || null,
      }))

    const producidoLimpio = Object.entries(producido)
      .filter(([, cant]) => Number(cant) > 0)
      .map(([product_id, cant]) => {
        const p = productosSector.find(prod => prod.id === product_id)
        return { product_id, quantity: Number(cant), unit: p?.base_unit || 'KG' }
      })

    if (!insumosLimpios.length && !producidoLimpio.length) {
      mostrarToast('Cargá al menos un insumo o un producto', 'err')
      return
    }

    setGuardando(true)
    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, notes, insumos: insumosLimpios, producido: producidoLimpio }),
      })
      if (!res.ok) throw new Error()
      mostrarToast('Producción del día guardada ✓')
      cargar(fecha)
    } catch {
      mostrarToast('Error al guardar', 'err')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <main style={st.main}>
      {toast && (
        <div style={{ ...st.toast, background: toast.tipo === 'err' ? '#7f1d1d' : '#14532d', borderColor: toast.tipo === 'err' ? '#ef4444' : '#22c55e' }}>
          {toast.msg}
        </div>
      )}

      <h2 style={st.titulo}>Producción del día — {sectorLabel}</h2>

      <div style={st.fechaBar}>
        <label style={st.label}>Fecha:</label>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={st.inputFecha} />
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#8899aa' }}>Cargando...</div>
      ) : (
        <>
          <section style={st.seccion}>
            <h3 style={st.tituloSeccion}>Materia prima e insumos retirados de Depósito</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={st.tabla}>
                <thead>
                  <tr>
                    <th style={st.th}>Producto</th>
                    <th style={{ ...st.th, width: '90px' }}>Cantidad</th>
                    <th style={{ ...st.th, width: '90px' }}>Unidad</th>
                    <th style={{ ...st.th, width: '120px' }}>Marca</th>
                    <th style={{ ...st.th, width: '110px' }}>Lote</th>
                    <th style={{ ...st.th, width: '150px' }}>Vencimiento</th>
                    <th style={{ ...st.th, width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {insumos.map(row => (
                    <tr key={row._key}>
                      <td style={st.td}>
                        <select value={row.product_id} onChange={e => cambiarInsumo(row._key, 'product_id', e.target.value)} style={st.select}>
                          <option value="">— Elegir —</option>
                          {productosInsumo.map(p => (
                            <option key={p.id} value={p.id}>{p.official_name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={st.td}>
                        <input
                          type="number" min="0" value={row.quantity}
                          onChange={e => cambiarInsumo(row._key, 'quantity', e.target.value)}
                          onClick={e => e.target.select()}
                          style={st.inputNum}
                        />
                      </td>
                      <td style={st.td}>
                        <select value={row.unit} onChange={e => cambiarInsumo(row._key, 'unit', e.target.value)} style={st.select}>
                          <option value="KG">KG</option>
                          <option value="UNIDAD">UNIDAD</option>
                        </select>
                      </td>
                      <td style={st.td}>
                        <input type="text" value={row.brand} onChange={e => cambiarInsumo(row._key, 'brand', e.target.value)} style={st.inputText} />
                      </td>
                      <td style={st.td}>
                        <input type="text" value={row.lot_code} onChange={e => cambiarInsumo(row._key, 'lot_code', e.target.value)} style={st.inputText} />
                      </td>
                      <td style={st.td}>
                        <input type="date" value={row.expires_at} onChange={e => cambiarInsumo(row._key, 'expires_at', e.target.value)} style={st.inputText} />
                      </td>
                      <td style={{ ...st.td, textAlign: 'center' }}>
                        <button onClick={() => quitarInsumo(row._key)} style={st.btnQuitar} title="Quitar fila">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={agregarInsumo} style={st.btnAgregar}>+ Agregar insumo</button>
          </section>

          <section style={st.seccion}>
            <h3 style={st.tituloSeccion}>Carga de producción diaria de {sectorLabel}</h3>
            {productosSector.length === 0 ? (
              <p style={{ color: '#8899aa', fontSize: '13px' }}>
                Todavía no hay productos marcados como producidos en {sectorLabel}. Se marcan desde Admin → Catálogo.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={st.tabla}>
                  <thead>
                    <tr>
                      <th style={st.th}>Descripción</th>
                      <th style={{ ...st.th, width: '120px', textAlign: 'center' }}>Cantidad</th>
                      <th style={{ ...st.th, width: '80px' }}>Unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosSector.map(p => (
                      <tr key={p.id}>
                        <td style={st.td}>{p.official_name}</td>
                        <td style={st.td}>
                          <input
                            type="number" min="0" value={producido[p.id] || ''}
                            onChange={e => cambiarProducido(p.id, e.target.value)}
                            onClick={e => e.target.select()}
                            style={st.inputNum}
                          />
                        </td>
                        <td style={{ ...st.td, color: '#8899aa', fontSize: '12px' }}>{p.base_unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={st.seccion}>
            <label style={st.label}>Notas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={st.textarea} />
          </section>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', paddingBottom: '2rem' }}>
            <button onClick={guardar} disabled={guardando} style={{ ...st.btnGuardar, opacity: guardando ? 0.5 : 1, cursor: guardando ? 'not-allowed' : 'pointer' }}>
              {guardando ? 'Guardando...' : '✓ Guardar producción del día'}
            </button>
          </div>
        </>
      )}
    </main>
  )
}

const st = {
  main:          { flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column' },
  titulo:        { color: 'white', fontSize: '1.3rem', fontWeight: '700', marginBottom: '1rem' },
  fechaBar:      { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.2rem', padding: '10px 14px', background: '#0d1a2a', borderRadius: '8px', border: '1px solid #1e3050' },
  label:         { color: '#7a9bb8', fontSize: '12px', fontWeight: '600' },
  inputFecha:    { background: '#162236', border: '1px solid #243550', borderRadius: '6px', color: '#c8d8e8', fontSize: '13px', padding: '5px 10px', outline: 'none' },
  seccion:       { marginBottom: '1.8rem' },
  tituloSeccion: { color: 'white', fontSize: '14px', fontWeight: '700', marginBottom: '0.7rem' },
  tabla:         { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th:            { background: '#0f1c2e', color: '#4a7fa5', padding: '8px 10px', textAlign: 'left', fontSize: '11px', fontWeight: '700', letterSpacing: '.05em', textTransform: 'uppercase', borderBottom: '1px solid #243550' },
  td:            { color: '#c8d8e8', padding: '6px 10px', borderBottom: '1px solid #1a2a3a' },
  select:        { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '13px', padding: '5px 6px', width: '100%', outline: 'none' },
  inputNum:      { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '14px', fontWeight: '600', padding: '4px 6px', width: '75px', textAlign: 'center', outline: 'none' },
  inputText:     { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '5px', color: 'white', fontSize: '13px', padding: '4px 6px', width: '100%', outline: 'none' },
  textarea:      { background: '#0f1c2e', border: '1px solid #243550', borderRadius: '6px', color: 'white', fontSize: '13px', padding: '8px', width: '100%', outline: 'none', resize: 'vertical', marginTop: '4px' },
  btnAgregar:    { marginTop: '8px', background: 'none', border: '1px dashed #243550', borderRadius: '6px', color: '#7a9bb8', fontSize: '12px', fontWeight: '600', padding: '6px 14px', cursor: 'pointer' },
  btnQuitar:     { background: 'none', border: '1px solid #7f1d1d', borderRadius: '5px', color: '#ef4444', fontSize: '12px', padding: '3px 8px', cursor: 'pointer' },
  btnGuardar:    { background: '#22c55e', border: 'none', borderRadius: '7px', color: 'white', fontSize: '13px', fontWeight: '700', padding: '10px 24px', cursor: 'pointer' },
  toast:         { position: 'fixed', bottom: '24px', right: '24px', border: '1px solid', borderRadius: '8px', color: 'white', fontSize: '13px', fontWeight: '600', padding: '12px 20px', zIndex: 200 },
}
