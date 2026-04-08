import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ImportClient from './import-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function MachineRatesImportPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  return (
    <div className="p-8 max-w-6xl">
      <ImportClient orgId={org.id} orgSlug={slug} />
    </div>
  )
}
