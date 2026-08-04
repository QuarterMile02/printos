import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import type { Modifier } from '@/types/product-builder'
import { dbOrThrow, DbError } from '@/lib/db'
import ModifiersClient from './modifiers-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function ModifiersPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[modifiers] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (modifiers)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('slug', slug)
      .maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  // All four queries below depend only on org.id, not on each other's
  // results — run them together instead of chaining sequential awaits,
  // which just stacks round trips before anything can render.
  type MemberRow = { user_id: string; role: string }
  const [userResult, memberRows, modifiers, countRes] = await Promise.all([
    supabase.auth.getUser(),
    dbOrThrow(
      supabase.from('organization_members').select('user_id, role').eq('organization_id', org.id)
    ) as Promise<MemberRow[] | null>,
    dbOrThrow(
      supabase
        .from('modifiers')
        .select('*')
        .eq('organization_id', org.id)
        .order('display_name', { ascending: true })
        .limit(1000)
    ) as Promise<Modifier[] | null>,
    supabase
      .from('modifiers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  if (countRes.error) throw new DbError(countRes.error)
  const userId = userResult.data.user?.id ?? ''
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'
  const totalCount = countRes.count ?? 0

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-500">Settings</span>
          <span>/</span>
          <span className="text-gray-700">Modifiers</span>
        </div>
      </div>

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      <ModifiersClient
        orgId={org.id}
        orgSlug={slug}
        userId={userId}
        userRole={userRole}
        initialModifiers={modifiers ?? []}
      />
    </div>
  )
}
