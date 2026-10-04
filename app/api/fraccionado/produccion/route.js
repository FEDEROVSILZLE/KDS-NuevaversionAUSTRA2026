// app/api/fraccionado/produccion/route.js
import { getProduccionDiaria, postProduccionDiaria } from '@/lib/produccionDiaria'

export async function GET(request)  { return getProduccionDiaria(request, 'FRACCIONADO') }
export async function POST(request) { return postProduccionDiaria(request, 'FRACCIONADO') }
