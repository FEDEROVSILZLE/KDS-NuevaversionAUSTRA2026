// scripts/tickets-jobs.js
// Jobs de tickets de producción:
//   - cada 15 min: autocierre de tickets abandonados (>4x lo esperado o >10 h)
//   - todos los días 04:30: recalcula el historial de tiempos (p50/p90)
//   - a la hora de fin de turno: cierra todo lo abierto (salvo allows_long_run)
//
// Uso:
//   node scripts/tickets-jobs.js            -> queda corriendo (dejalo con pm2 o como servicio)
//   node scripts/tickets-jobs.js autoclose  -> corre una vez y sale (para el Programador de tareas de Windows)
//   node scripts/tickets-jobs.js refresh
//   node scripts/tickets-jobs.js fin-turno
//
// Config en .env:
//   DATABASE_URL=...
//   TICKETS_FIN_TURNO=23:00     (hora local; vacío = no cerrar por turno)

require('dotenv').config({ quiet: true })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const TZ = 'America/Argentina/Buenos_Aires'
const FIN_TURNO = (process.env.TICKETS_FIN_TURNO ?? '23:00').trim()

const log = (...a) => console.log(new Date().toLocaleString('es-AR', { timeZone: TZ }), ...a)

const jobs = {
  async autoclose() {
    const { rows } = await pool.query('SELECT operations.ticket_auto_close_stale() AS n')
    if (rows[0].n > 0) log(`autocierre: ${rows[0].n} ticket(s) -> AUTO_CLOSED (revisar bandeja)`)
  },
  async refresh() {
    await pool.query('SELECT operations.refresh_ticket_history()')
    log('historial de tiempos recalculado')
  },
  async 'fin-turno'() {
    const { rows } = await pool.query('SELECT operations.ticket_auto_close_stale(p_close_all => TRUE) AS n')
    log(`fin de turno: ${rows[0].n} ticket(s) cerrados`)
  },
}

async function run(name) {
  try {
    await jobs[name]()
  } catch (err) {
    log(`ERROR en ${name}:`, err.message)
  }
}

// HH:MM actual en hora de Argentina (independiente del huso del servidor)
function nowHHMM() {
  return new Date().toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

async function main() {
  const once = process.argv[2]
  if (once) {
    if (!jobs[once]) {
      console.error(`Job desconocido: ${once}. Opciones: ${Object.keys(jobs).join(', ')}`)
      process.exit(1)
    }
    await run(once)
    await pool.end()
    return
  }

  log(`tickets-jobs arrancado (fin de turno: ${FIN_TURNO || 'desactivado'})`)
  await run('autoclose')

  setInterval(() => run('autoclose'), 15 * 60 * 1000)

  // chequeo por minuto para los jobs con hora fija
  let lastFired = {}
  setInterval(() => {
    const hhmm = nowHHMM()
    const today = new Date().toLocaleDateString('es-AR', { timeZone: TZ })
    const fire = (name, at) => {
      if (hhmm === at && lastFired[name] !== today) {
        lastFired[name] = today
        run(name)
      }
    }
    fire('refresh', '04:30')
    if (FIN_TURNO) fire('fin-turno', FIN_TURNO)
  }, 30 * 1000)
}

main()
