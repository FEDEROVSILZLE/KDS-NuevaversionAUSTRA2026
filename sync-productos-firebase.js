// sync-productos-firebase.js
// Corre con: node sync-productos-firebase.js
// Requiere: npm install firebase-admin @prisma/client

const { PrismaClient } = require('@prisma/client')
const admin = require('firebase-admin')

// ─── Inicializar Firebase Admin ───────────────────────────────────────────────
// Necesitás bajar el serviceAccountKey.json desde:
// Firebase Console → Project Settings → Service accounts → Generate new private key
const serviceAccount = require('./serviceAccountKey.json')

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const firestore = admin.firestore()
const prisma = new PrismaClient()

// ─── Configuración ────────────────────────────────────────────────────────────
const COLECCION_PRODUCTOS   = 'productos'
const COLECCION_SUCURSALES  = 'sucursales'
const BATCH_SIZE = 400  // Firestore permite hasta 500 por batch

// ─── Sucursales hardcodeadas (igual que el login) ────────────────────────────
const SUCURSALES = [
  { id: 'LMA', nombre: 'La Loma' },
  { id: 'RDT', nombre: 'Rada Tilly' },
  { id: 'KND', nombre: 'Kennedy' },
  { id: 'POL', nombre: 'Polonia' },
  { id: 'KM3', nombre: 'Km 3' },
  { id: 'KM8', nombre: 'Km 8' },
  { id: 'CLO', nombre: 'Caleta Olivia' },
]

// ─── Sync productos ───────────────────────────────────────────────────────────
async function syncProductos() {
  console.log('📦 Leyendo productos de PostgreSQL...')

  const productos = await prisma.products.findMany({
    where: {
      is_active: true,
      is_for_branches: true,
    },
    select: {
      id: true,
      official_name: true,
      base_unit: true,
      condition: true,
      sub_condition: true,
    },
    orderBy: { official_name: 'asc' },
  })

  console.log(`   → ${productos.length} productos encontrados`)

  // Escribir en batches
  let count = 0
  for (let i = 0; i < productos.length; i += BATCH_SIZE) {
    const chunk = productos.slice(i, i + BATCH_SIZE)
    const batch = firestore.batch()

    chunk.forEach(p => {
      const ref = firestore.collection(COLECCION_PRODUCTOS).doc(p.id)
      batch.set(ref, {
        id:            p.id,
        nombre:        p.official_name,
        unidad:        p.base_unit,
        condition:     p.condition   || '',
        sub_condition: p.sub_condition || '',
        para_sucursales: true,
        actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()
    count += chunk.length
    console.log(`   ✓ ${count}/${productos.length} productos sincronizados`)
  }

  console.log(`✅ Sync de productos completado: ${count} docs en '${COLECCION_PRODUCTOS}'`)
}

// ─── Sync sucursales ──────────────────────────────────────────────────────────
async function syncSucursales() {
  console.log('\n🏪 Sincronizando sucursales...')
  const batch = firestore.batch()

  SUCURSALES.forEach(s => {
    const ref = firestore.collection(COLECCION_SUCURSALES).doc(s.id)
    batch.set(ref, { id: s.id, nombre: s.nombre })
  })

  await batch.commit()
  console.log(`✅ ${SUCURSALES.length} sucursales sincronizadas en '${COLECCION_SUCURSALES}'`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Iniciando sincronización PostgreSQL → Firebase\n')
  try {
    await syncProductos()
    await syncSucursales()
    console.log('\n🎉 Todo sincronizado correctamente.')
  } catch (err) {
    console.error('❌ Error durante la sincronización:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
    process.exit(0)
  }
}

main()
