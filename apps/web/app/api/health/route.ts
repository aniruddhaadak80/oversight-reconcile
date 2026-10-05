import { NextResponse } from 'next/server'
import { healthBody } from '@/lib/health'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const startedAt = Date.now()

/**
 * The endpoint the deployment is proven with. `uptimeSeconds` is the only thing that varies
 * between two identical calls, and that is the point of including it.
 */
export function GET() {
  const body = healthBody()
  return NextResponse.json(
    { ...body, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) },
    {
      status: body['ok'] === true ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
