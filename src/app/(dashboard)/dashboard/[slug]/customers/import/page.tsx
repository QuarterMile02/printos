import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ImportClient from './import-client'
import { dbOrThrow } from '@/lib/db'

type PageProps = { params: Promise<{ slug: string }> }

export default async function CustomersImportPage(props: PageProps) {
  try {
    return await CustomersImportPageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[customers-import] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (customers-import)</h1>
        <div>{message}</div>
      </div>
    )
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
