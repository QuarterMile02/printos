import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import PricingFormulasClient, { type PricingFormula } from './pricing-formulas-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pricing-formulas] page crash:', err)
    return (
      <div
        style={{
          padding: '2rem',
          color: '#b91c1c',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
          PAGE ERROR (pricing formulas)
        </h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()
  const service = createServiceClient()

  const org = await dbOrThrow(
    supabase
      .from('organizations')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return <div className="p-8 text-red-600">Not authenticated</div>
  }

  const memberRow = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .maybeSingle()
  ) as { role: string } | null

  // Create still follows the original owner-or-admin gate (unchanged).
  // TEMPORARY: edit/delete/lock on pricing formulas is gated to the
  // 'owner' role directly because there is no real Team Roles &
  // Permissions system yet. Once one exists, replace isOwner with a
  // proper permission check and remove this comment.
  const isOwnerOrAdmin =
    memberRow?.role === 'owner' || memberRow?.role === 'admin'
  const isOwner = memberRow?.role === 'owner'

  const formulas = await dbOrThrow(
    service
      .from('pricing_formulas')
      .select('id, organization_id, name, formula, uom, is_system, is_locked, description, created_at')
      .or(`organization_id.eq.${org.id},is_system.eq.true`)
      .order('name', { ascending: true })
  )

  return (
    <div className="max-w-5xl p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">
          {org.name}
        </Link>
        <span>/</span>
        <span className="text-gray-700">Pricing Formulas</span>
      </div>

      <PricingFormulasClient
        orgId={org.id}
        orgSlug={slug}
        initialFormulas={(formulas ?? []) as PricingFormula[]}
        isOwnerOrAdmin={isOwnerOrAdmin}
        isOwner={isOwner}
      />
    </div>
  )
}
