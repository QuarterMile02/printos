import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import ImportClient from './import-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function MaterialsImportPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('materials-import', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; slug: string }
  const org = await dbOrThrow(
    supabase
      .from('organizations')
      .select('id, slug')
      .eq('slug', slug)
      .maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  return (
    <div className="p-8 max-w-6xl">
      <ImportClient orgId={org.id} orgSlug={slug} />
    </div>
  )
}
