// app/api/armado/produccion/route.js
import { getProduccionDiaria, postProduccionDiaria } from '@/lib/produccionDiaria'

export async function GET(request)  { return getProduccionDiaria(request, 'ARMADO') }
export async function POST(request) { return postProduccionDiaria(request, 'ARMADO') }
