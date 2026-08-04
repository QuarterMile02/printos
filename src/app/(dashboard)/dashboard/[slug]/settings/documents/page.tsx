import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import DocumentsClient, { type DocumentSettingsRow } from './documents-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('documents-settings', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="p-8 text-red-600">Not authenticated</div>

  const memberRow = await dbOrThrow(
    supabase.from('organization_members').select('role')
      .eq('organization_id', org.id).eq('user_id', user.id).maybeSingle()
  ) as { role: string } | null

  const isOwnerOrAdmin = memberRow?.role === 'owner' || memberRow?.role === 'admin'

  const settingsRows = await dbOrThrow(
    supabase
      .from('document_settings')
      .select('*')
      .eq('organization_id', org.id)
  ) ?? []

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Documents</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="mt-1 text-sm text-gray-500">
          PDF settings and terms for each document type.
        </p>
      </div>

      {!isOwnerOrAdmin ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          Only owners and admins can manage document settings. Contact your organization owner.
        </div>
      ) : (
        <DocumentsClient
          orgId={org.id}
          orgSlug={slug}
          initialSettings={(settingsRows ?? []) as DocumentSettingsRow[]}
        />
      )}
    </div>
  )
}
