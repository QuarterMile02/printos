import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import ImportClient from './import-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function ProductsImportPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[products-import] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (products-import)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
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
