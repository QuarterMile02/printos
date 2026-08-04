import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import ImportClient from './import-client'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

type PageProps = { params: Promise<{ slug: string }> }

export default async function CustomersImportPage(props: PageProps) {
  try {
    return await CustomersImportPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('customers-import', err)
  }
}

async function CustomersImportPageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  return (
    <div className="p-8 max-w-6xl">
      <ImportClient orgId={org.id} orgSlug={slug} />
    </div>
  )
}
