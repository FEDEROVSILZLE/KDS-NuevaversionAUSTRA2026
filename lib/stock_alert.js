// lib/stock_alert.js
// Servicio de alertas de stock usando Resend
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// ── Destinatarios ─────────────────────────────────────────────────────────────
const DESTINATARIOS = [
  process.env.ALERT_EMAIL_1,
  // process.env.ALERT_EMAIL_2,   ← aquí deberían ir los otros mails
  // process.env.ALERT_EMAIL_3,   ← aquí deberían ir los otros mails
].filter(Boolean) // filtra los que no estén configurados

// ── Template del mail ─────────────────────────────────────────────────────────
function generarHTML({ sector, productos, usuario, fecha, hora }) {
  const filas = productos.map(p => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px">
        ${p.product_name}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:center;color:#ef4444;font-weight:700">
        ${p.quantity} ${p.unit}
      </td>
    </tr>
  `).join('')

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"/></head>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif">
      <div style="max-width:560px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        
        <!-- Header -->
        <div style="background:#0f1c2e;padding:24px 28px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="color:white;font-size:18px;font-weight:700;letter-spacing:.04em">AUSTRA</span>
            <span style="color:#7dd3fc;font-size:18px;font-weight:700">KDS</span>
          </div>
          <h1 style="color:white;font-size:20px;font-weight:700;margin:12px 0 4px">
            ⚠️ Alerta de stock bajo
          </h1>
          <p style="color:#8899aa;font-size:13px;margin:0">
            Sector ${sector} · ${fecha} · ${hora}
          </p>
        </div>

        <!-- Cuerpo -->
        <div style="padding:24px 28px">
          <p style="color:#374151;font-size:14px;margin:0 0 16px">
            Se detectaron <strong>${productos.length} producto${productos.length !== 1 ? 's' : ''}</strong> 
            con stock en <strong style="color:#ef4444">0</strong> 
            durante el conteo del sector <strong>${sector}</strong>.
          </p>

          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f9fafb">
                <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">
                  Producto
                </th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;width:100px">
                  Stock actual
                </th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>

          <div style="margin-top:20px;padding:14px 16px;background:#fef3c7;border-radius:8px;border-left:4px solid #f59e0b">
            <p style="color:#92400e;font-size:13px;margin:0;font-weight:600">
              Acción requerida
            </p>
            <p style="color:#92400e;font-size:13px;margin:4px 0 0">
              Verificar disponibilidad y reponer antes del próximo turno.
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:12px;margin:0">
            Conteo realizado por <strong>${usuario}</strong> · Sistema KDS Austra
          </p>
        </div>

      </div>
    </body>
    </html>
  `
}

// ── Función principal ─────────────────────────────────────────────────────────
export async function enviarAlertaStockBajo({ sector, productos, usuario }) {
  if (!productos.length) return { enviado: false, motivo: 'sin productos en 0' }
  if (!DESTINATARIOS.length) return { enviado: false, motivo: 'sin destinatarios configurados' }
  if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: 'RESEND_API_KEY no configurada' }

  const ahora = new Date()
  const fecha = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(ahora)

  const hora = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit'
  }).format(ahora)

  try {
    const { data, error } = await resend.emails.send({
      from:    'KDS Austra <onboarding@resend.dev>', // cambiar por tu dominio cuando esté configurado
      to:      DESTINATARIOS,
      subject: `⚠️ Stock bajo — ${sector} — ${fecha}`,
      html:    generarHTML({ sector, productos, usuario, fecha, hora }),
    })

    if (error) {
      console.error('Error Resend:', error)
      return { enviado: false, motivo: error.message }
    }

    console.log(`✅ Alerta enviada a ${DESTINATARIOS.join(', ')} — ID: ${data.id}`)
    return { enviado: true, mail_id: data.id, destinatarios: DESTINATARIOS }

  } catch (err) {
    console.error('Error enviando alerta:', err)
    return { enviado: false, motivo: err.message }
  }
}
