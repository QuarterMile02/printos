import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Modifier } from '@/types/product-builder'
import ModifiersClient from './modifiers-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function ModifiersPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: modifiers } = await supabase
    .from('modifiers')
    .select('*')
    .eq('organization_id', org.id)
    .order('display_name', { ascending: true }) as { data: Modifier[] | null; error: unknown }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-500">Settings</span>
          <span>/</span>
          <span className="text-gray-700">Modifiers</span>
        </div>
      </div>

      <ModifiersClient
        orgId={org.id}
        orgSlug={slug}
        initialModifiers={modifiers ?? []}
      />
    </div>
  )
}
