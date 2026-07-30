import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Shared by all /api/materials/[id]/pricing-tiers routes: resolves the
// authenticated caller's org (same pattern as /api/materials), and
// confirms a given material belongs to that org before letting the
// caller touch its pricing tiers.

export async function getSupabaseAndOrg() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, orgId: null as string | null }
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  return { supabase, orgId: (profile as { organization_id: string } | null)?.organization_id ?? null }
}

export async function materialBelongsToOrg(
  supabase: Awaited<ReturnType<typeof getSupabaseAndOrg>>['supabase'],
  materialId: string,
  orgId: string,
) {
  const { data } = await supabase
    .from('materials')
    .select('id')
    .eq('id', materialId)
    .eq('organization_id', orgId)
    .single()
  return !!data
}
