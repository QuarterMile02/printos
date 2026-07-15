import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import NewQuoteForm from './new-quote-form'

type PageProps = { params: Promise<{ slug: string }> }

export default async function NewQuotePage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  // Team members for the sales rep dropdown
  type TeamMember = { user_id: string; role: string; profiles: { full_name: string | null; email: string } | null }
  const { data: teamRows } = await supabase
    .from('organization_members')
    .select('user_id, role, profiles(full_name, email)')
    .eq('organization_id', org.id)
    .in('role', ['owner', 'admin', 'member']) as { data: TeamMember[] | null; error: unknown }

  const teamMembers = (teamRows ?? []).map((m) => ({
    id: m.user_id,
    name: m.profiles?.full_name || m.profiles?.email || m.user_id,
  }))

  // Products for the inline line item picker
  type ProductOption = { id: string; name: string; formula: string | null }
  const { data: products } = await supabase
    .from('products')
    .select('id, name, formula')
    .eq('organization_id', org.id)
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(2000) as { data: ProductOption[] | null; error: unknown }

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
        products={products ?? []}
      />
    </div>
  )
}
