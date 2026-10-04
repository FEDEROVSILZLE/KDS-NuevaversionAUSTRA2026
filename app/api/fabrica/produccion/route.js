// app/api/fabrica/produccion/route.js
import { getProduccionDiaria, postProduccionDiaria } from '@/lib/produccionDiaria'

export async function GET(request)  { return getProduccionDiaria(request, 'FABRICA') }
export async function POST(request) { return postProduccionDiaria(request, 'FABRICA') }
