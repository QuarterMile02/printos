import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import MaterialForm from '../material-form'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/materials`} className="hover:text-gray-700">Materials</Link>
        <span>/</span>
        <span className="text-gray-700">New</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Material</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <MaterialForm material={null} orgId={org.id} orgSlug={slug} />
      </div>
    </div>
  )
}
