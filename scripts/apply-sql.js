// scripts/apply-sql.js
// Aplica un archivo .sql contra DATABASE_URL (sin necesitar psql instalado).
// El archivo maneja su propia transacción (BEGIN/COMMIT): si falla, no queda nada a medias.
//
//   node scripts/apply-sql.js sql/tickets_produccion.sql

require('dotenv').config({ quiet: true })
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Uso: node scripts/apply-sql.js <archivo.sql>')
    process.exit(1)
  }
  const sql = fs.readFileSync(path.resolve(file), 'utf8')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  client.on('notice', (n) => console.log('NOTICE:', n.message))
  await client.connect()
  try {
    await client.query(sql)
    console.log(`OK: ${file} aplicado`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`ERROR aplicando ${file}: ${err.message}`)
    if (err.position) {
      const line = sql.slice(0, Number(err.position)).split('\n').length
      console.error(`  cerca de la línea ${line}`)
    }
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
