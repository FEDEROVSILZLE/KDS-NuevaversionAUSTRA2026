// app/api/armado/estimacion/route.js
// GET → estimación de relleno para Cocina usando la función SQL

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function GET(request) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.sector !== 'ARMADO') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const fecha = searchParams.get('fecha') || (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })()

  try {
    // Llamar directamente a la función SQL que ya tenemos
    const resultado = await prisma.$queryRaw`
      SELECT
        filling_product,
        empanada_type,
        empanadas_confirmadas::float,
        growth_factor::float,
        empanadas_proyectadas::float,
        kg_relleno_necesario::float,
        kg_stock_vigente::float,
        kg_stock_vence_hoy::float,
        kg_pedir_a_cocina::float,
        alerta
      FROM operations.estimate_filling_needed(${new Date(fecha)}::date)
    `

    return NextResponse.json(resultado)
  } catch (error) {
    console.error('Error calculando estimación:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
