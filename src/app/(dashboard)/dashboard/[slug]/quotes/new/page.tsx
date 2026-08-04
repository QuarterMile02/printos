import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import NewQuoteForm from './new-quote-form'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

type PageProps = { params: Promise<{ slug: string }> }

export default async function NewQuotePage(props: PageProps) {
  try {
    return await NewQuotePageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('quotes-new', err)
  }
}

async function NewQuotePageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  // ── Team members for the sales rep dropdown ──────────────────────────────
  // Must use service client for profiles — the only RLS SELECT policy on
  // profiles is `auth.uid() = id` (migration 001), so a regular client can
  // only see its own row. organization_members.user_id also FKs to auth.users,
  // not to profiles, so PostgREST embedded joins don't work here.

  type RawMemberRow = { user_id: string }
  const rawMembers = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id)
      .in('role', ['owner', 'admin', 'member'])
  ) as RawMemberRow[] | null

  const memberUserIds = (rawMembers ?? []).map(m => m.user_id)

  const service = createServiceClient()
  const nameMap = new Map<string, string>()

  if (memberUserIds.length > 0) {
    // Fetch full_name from profiles via service client (bypasses RLS)
    type ProfileRow = { id: string; full_name: string | null }
    const profileRows = await dbOrThrow(
      service
        .from('profiles')
        .select('id, full_name')
        .in('id', memberUserIds)
    ) as ProfileRow[] | null
    for (const p of profileRows ?? []) {
      if (p.full_name) nameMap.set(p.id, p.full_name)
    }

    // Fetch emails from auth.users as fallback for members without a full_name
    const missing = memberUserIds.filter(id => !nameMap.has(id))
    if (missing.length > 0) {
      const { data: { users: authUsers } } = await service.auth.admin.listUsers()
      for (const u of authUsers ?? []) {
        if (!nameMap.has(u.id) && u.email) nameMap.set(u.id, u.email)
      }
    }
  }

  const teamMembers = memberUserIds
    .map(id => ({ id, name: nameMap.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/quotes`} className="hover:text-gray-700">Quotes</Link>
        <span>/</span>
        <span className="text-gray-700">New Quote</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">New Quote</h1>
      <p className="mt-1 text-sm text-gray-500">A quote number will be assigned automatically.</p>

      <NewQuoteForm
        orgId={org.id}
        orgSlug={slug}
        teamMembers={teamMembers}
        currentUserId={currentUserId}
      />
    </div>
  )
}
