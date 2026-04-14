import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { redirect } from 'next/navigation'

export default async function CocinaPage() {
  const session = await getServerSession(authOptions)
  
  if (!session || session.user?.sector !== 'COCINA') {
    redirect('/')
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f4f7fb',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{
        background: '#0f1c2e', height: '44px',
        display: 'flex', alignItems: 'center',
        padding: '0 1rem', gap: '10px'
      }}>
        <span style={{ color: 'white', fontWeight: '700', letterSpacing: '.06em' }}>AUSTRA</span>
        <span style={{ color: '#2196f3', fontSize: '11px', fontWeight: '600', fontFamily: 'monospace' }}>COCINA</span>
        <span style={{ marginLeft: 'auto', color: '#8899aa', fontSize: '11px', fontFamily: 'monospace' }}>
          {session.user?.name}
        </span>
      </div>
      <div style={{ padding: '2rem' }}>
        <h2 style={{ color: '#0f1c2e', marginBottom: '1rem' }}>✓ Sesión activa — Sector Cocina</h2>
        <p style={{ color: '#556677' }}>Usuario: {session.user?.name}</p>
        <p style={{ color: '#556677' }}>Sector: {session.user?.sector}</p>
      </div>
    </div>
  )
}
