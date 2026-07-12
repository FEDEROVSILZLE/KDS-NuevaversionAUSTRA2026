'use client'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ChefHat, Wheat, PackageOpen, Split,
  Warehouse, Receipt, Boxes, ShieldCheck, Store,
} from 'lucide-react'

const SECTORES_INTERNOS = [
  { code: 'COCINA',      name: 'Cocina',      Icon: ChefHat,     color: '#c084fc', ruta: '/cocina' },
  { code: 'FABRICA',     name: 'Fábrica',     Icon: Wheat,       color: '#fcd34d', ruta: '/fabrica' },
  { code: 'ARMADO',      name: 'Armado',      Icon: PackageOpen, color: '#fbbf24', ruta: '/armado' },
  { code: 'DEPOSITO',    name: 'Depósito',    Icon: Warehouse,   color: '#f87171', ruta: '/deposito' },
  { code: 'FRACCIONADO', name: 'Fraccionado', Icon: Split,       color: '#f472b6', ruta: '/fraccionado' },
  { code: 'REMITOS',     name: 'Remitos',     Icon: Receipt,     color: '#cbd5e1', ruta: '/remitos' },
  { code: 'STOCK',       name: 'Stock',       Icon: Boxes,       color: '#22d3ee', ruta: '/stock' },
  { code: 'ADMIN',       name: 'Admin',       Icon: ShieldCheck, color: '#fb923c', ruta: '/admin' },
]

const SUCURSALES = [
  { code: 'LMA', name: 'La Loma' },
  { code: 'RDT', name: 'Rada Tilly' },
  { code: 'KND', name: 'Kennedy' },
  { code: 'POL', name: 'Polonia' },
  { code: 'KM3', name: 'Km 3' },
  { code: 'KM8', name: 'Km 8' },
  { code: 'CLO', name: 'Caleta Olivia' },
]

export default function Home() {
  const [selected, setSelected]         = useState(null)
  const [sucSelected, setSucSelected]   = useState(null)
  const [showSucursales, setShowSucursales] = useState(false)
  const [password, setPassword]         = useState('')
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(false)
  const router = useRouter()

  const handleLogin = async (e) => {
    e.preventDefault()
    const loginTarget = showSucursales ? sucSelected : selected
    if (!loginTarget) return
    setLoading(true)
    setError('')

    const res = await signIn('credentials', {
      sector_code: loginTarget.code,
      password,
      redirect: false,
    })

    setLoading(false)

    if (res?.ok) {
      // Redirigir según el sector
      const ruta = SECTORES_INTERNOS.find(s => s.code === loginTarget.code)?.ruta || '/sucursales'
      router.push(ruta)
    } else {
      setError('Clave incorrecta. Intentá de nuevo.')
      setPassword('')
    }
  }

  const handleSectorClick = (s) => {
    if (s.code === 'SUCURSALES') {
      setShowSucursales(true)
      setSelected(null)
      setSucSelected(null)
      setError('')
      setPassword('')
    } else {
      setShowSucursales(false)
      setSelected(s)
      setSucSelected(null)
      setError('')
      setPassword('')
    }
  }

  const handleSucursalClick = (suc) => {
    setSucSelected(suc)
    setError('')
    setPassword('')
  }

  const handleBack = () => {
    setShowSucursales(false)
    setSucSelected(null)
    setSelected(null)
    setPassword('')
    setError('')
  }

  const loginTarget = showSucursales ? sucSelected : selected

  return (
    <div style={{
      minHeight: '100vh', background: '#0f1c2e',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: '2rem'
    }}>
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{ color: 'white', fontSize: '2rem', fontWeight: '700', letterSpacing: '.06em', margin: 0 }}>
          AUSTRA <span style={{ color: '#2196f3' }}>KDS</span>
        </h1>
        <p style={{ color: '#8899aa', fontSize: '.875rem', margin: '.5rem 0 0' }}>
          {showSucursales ? 'Seleccioná tu sucursal' : 'Seleccioná tu sector para ingresar'}
        </p>
      </div>

      {/* ── PANTALLA PRINCIPAL: sectores internos + botón sucursales ── */}
      {!showSucursales && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px', width: '100%', maxWidth: '640px', marginBottom: '1.5rem'
        }}>
          {SECTORES_INTERNOS.map(s => (
            <button key={s.code} onClick={() => handleSectorClick(s)}
              style={{
                background: selected?.code === s.code ? '#1d2f47' : '#162236',
                border: selected?.code === s.code ? '2px solid #2196f3' : '1px solid #243550',
                borderRadius: '8px', padding: '1rem .75rem', cursor: 'pointer',
                textAlign: 'center', transition: 'all .15s'
              }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
                <s.Icon size={28} strokeWidth={1.5} color={s.color} />
              </div>
              <div style={{ color: selected?.code === s.code ? 'white' : '#7a9bb8', fontSize: '11px', fontWeight: '600', letterSpacing: '.04em' }}>
                {s.name}
              </div>
            </button>
          ))}

          {/* Botón especial Sucursales */}
          <button onClick={() => handleSectorClick({ code: 'SUCURSALES' })}
            style={{
              background: '#162236', border: '1px solid #243550',
              borderRadius: '8px', padding: '1rem .75rem', cursor: 'pointer',
              textAlign: 'center', transition: 'all .15s'
            }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
              <Store size={28} strokeWidth={1.5} color="#fb7185" />
            </div>
            <div style={{ color: '#7a9bb8', fontSize: '11px', fontWeight: '600', letterSpacing: '.04em' }}>
              Sucursales
            </div>
          </button>
        </div>
      )}

      {/* ── PANTALLA SUCURSALES ── */}
      {showSucursales && (
        <div style={{ width: '100%', maxWidth: '640px', marginBottom: '1.5rem' }}>
          <button onClick={handleBack}
            style={{ background: 'none', border: 'none', color: '#4a7fa5', fontSize: '12px', cursor: 'pointer', marginBottom: '1rem', padding: 0 }}>
            ← Volver
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {SUCURSALES.map(suc => (
              <button key={suc.code} onClick={() => handleSucursalClick(suc)}
                style={{
                  background: sucSelected?.code === suc.code ? '#1d2f47' : '#162236',
                  border: sucSelected?.code === suc.code ? '2px solid #2196f3' : '1px solid #243550',
                  borderRadius: '8px', padding: '1rem .75rem', cursor: 'pointer',
                  textAlign: 'center', transition: 'all .15s'
                }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
                  <Store size={28} strokeWidth={1.5} color={sucSelected?.code === suc.code ? '#2196f3' : '#fb7185'} />
                </div>
                <div style={{ color: sucSelected?.code === suc.code ? 'white' : '#7a9bb8', fontSize: '11px', fontWeight: '600', letterSpacing: '.04em' }}>
                  {suc.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── FORMULARIO DE PIN ── */}
      {loginTarget && (
        <form onSubmit={handleLogin} style={{
          background: '#162236', border: '1px solid #243550',
          borderRadius: '10px', padding: '1.5rem', width: '100%', maxWidth: '320px'
        }}>
          <p style={{ color: '#8899aa', fontSize: '12px', margin: '0 0 .75rem', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Ingresá como <span style={{ color: 'white', fontWeight: '600' }}>{loginTarget.name}</span>
          </p>
          <input
            type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••" autoFocus
            style={{
              width: '100%', background: '#0f1c2e', border: '1px solid #243550',
              borderRadius: '5px', padding: '10px 12px', color: 'white',
              fontSize: '16px', letterSpacing: '.2em', outline: 'none',
              boxSizing: 'border-box', marginBottom: '.75rem'
            }}
          />
          {error && <p style={{ color: '#ef4444', fontSize: '12px', margin: '0 0 .75rem' }}>{error}</p>}
          <button type="submit" disabled={loading || !password}
            style={{
              width: '100%', background: loading ? '#243550' : '#2196f3',
              border: 'none', borderRadius: '5px', padding: '10px',
              color: 'white', fontSize: '13px', fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: '.04em'
            }}>
            {loading ? 'Ingresando...' : 'Ingresar →'}
          </button>
        </form>
      )}
    </div>
  )
}