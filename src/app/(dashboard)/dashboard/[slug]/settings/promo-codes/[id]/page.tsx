import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { generatePromoCode } from '@/lib/promo-code'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import PromoCodeForm from './promo-code-form'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('promo-code-detail', err)
  }
}

type PromoCode = {
  id: string
  name: string
  code: string
  discount_type: string
  value: number
  minimum_requirement: number | null
  limit_of_using: number
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug, id } = await params
  const sp = await searchParams
  const isNew = id === 'new'
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  let promo: PromoCode | null = null
  if (!isNew) {
    promo = await dbOrThrow(
      supabase
        .from('promo_codes')
        .select('id, name, code, discount_type, value, minimum_requirement, limit_of_using, valid_from, valid_to, is_active')
        .eq('id', id)
        .eq('organization_id', org.id)
        .maybeSingle()
    ) as PromoCode | null
    if (!promo) return <div className="p-8 text-red-600">Promo code not found</div>
  }

  // Delete requires the code to already be deactivated. No linked-record
  // check yet -- promo codes aren't wired into any checkout flow, so
  // there's no redemption/usage table to check against.
  const canDelete = !isNew && promo?.is_active === false
  const deleteBlockedReason = 'Deactivate this promo code first before it can be deleted.'

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/promo-codes`} className="hover:text-gray-700">Promo Codes</Link>
        <span>/</span>
        <span className="text-gray-700">{isNew ? 'New' : promo?.name}</span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{isNew ? 'New Promo Code' : `Edit: ${promo?.name}`}</h1>
        <p className="mb-6 text-xs text-gray-400">
          Management only for now — not yet redeemable from any quote or checkout flow.
        </p>

        {sp.error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.saved === '1' && (
          <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
            Saved successfully.
          </div>
        )}

        <PromoCodeForm
          orgId={org.id}
          orgSlug={slug}
          isNew={isNew}
          initialData={{
            id: promo?.id ?? null,
            name: promo?.name ?? '',
            code: promo?.code ?? generatePromoCode(),
            discount_type: promo?.discount_type ?? 'Percentage',
            value: promo?.value ?? 0,
            minimum_requirement: promo?.minimum_requirement ?? null,
            limit_of_using: promo?.limit_of_using ?? 0,
            valid_from: promo?.valid_from ?? null,
            valid_to: promo?.valid_to ?? null,
            is_active: promo?.is_active ?? true,
          }}
          canDelete={canDelete}
          deleteBlockedReason={deleteBlockedReason}
        />
      </div>
    </div>
  )
}
