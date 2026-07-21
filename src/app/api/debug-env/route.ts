import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    env_url: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30),
    env_key_prefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 15),
    node_env: process.env.NODE_ENV,
  })
}
