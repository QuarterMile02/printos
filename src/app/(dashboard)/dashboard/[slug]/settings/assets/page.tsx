import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import AssetsClient, { type AssetCategoryRow, type AssetRow } from './assets-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('assets-settings', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const categories = await dbOrThrow(
    supabase.from('asset_categories').select('id, name, sort_order').eq('organization_id', org.id).order('sort_order')
  ) as AssetCategoryRow[] ?? []

  const assets = await dbOrThrow(
    supabase.from('assets')
      .select('id, category_id, name, file_name, mime_type, file_size, created_at')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
  ) as AssetRow[] ?? []

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Assets</span>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Assets <span className="text-sm font-normal text-gray-400">({assets.length})</span>
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload files once, reuse them anywhere PrintOS sends something to a customer — quote emails,
          proofs, invoices, and more.
        </p>
      </div>

      <AssetsClient orgId={org.id} orgSlug={slug} initialCategories={categories} initialAssets={assets} />
    </div>
  )
}
