import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveMaterialType } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import MaterialTypesListClient, { type MaterialTypeRow } from './material-types-list-client'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('material-types', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.material_types')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Material Types</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage material types. Contact your organization owner.
        </div>
      </div>
    )
  }

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const memberRows = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id)
  ) as MemberRow[] | null
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  type MaterialType = MaterialTypeRow & { created_at: string }
  const typesData = await dbOrThrow(
    supabase
      .from('material_types')
      .select('id, name, is_active, created_at')
      .eq('organization_id', org.id)
      .order('name', { ascending: true })
  ) as MaterialType[] | null

  const types = (typesData ?? []) as MaterialType[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editType = editId ? types.find(t => t.id === editId) ?? null : null
  const isPanelOpen = Boolean(editType || showAdd)

  // Usage counts — only allow delete when count = 0
  const usageCounts: Record<string, number> = {}
  if (types.length > 0) {
    const usageData = await dbOrThrow(
      supabase
        .from('materials')
        .select('material_type_id')
        .eq('organization_id', org.id)
        .not('material_type_id', 'is', null)
    ) as { material_type_id: string }[] | null
    for (const r of (usageData ?? []) as { material_type_id: string }[]) {
      usageCounts[r.material_type_id] = (usageCounts[r.material_type_id] ?? 0) + 1
    }
  }

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Material Types</span>
      </div>

      <SettingsPageHeader
        title="Material Types"
        count={types.length}
        primaryAction={{ label: 'New Type', href: `/dashboard/${slug}/settings/material-types?add=1` }}
      />

      {sp.error && !isPanelOpen && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          {sp.error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {decodeURIComponent(sp.error)}
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editType ? 'Edit Material Type' : 'New Material Type'}
          </h2>
          <form action={saveMaterialType} className="space-y-4">
            {editType && <input type="hidden" name="id" value={editType.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div>
              <label className={labelCls}>Name *</label>
              <input type="text" name="name" required defaultValue={editType?.name ?? ''} className={inputCls} />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editType?.is_active !== false}
                className="h-4 w-4 accent-qm-lime"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Save
              </button>
              <Link
                href={`/dashboard/${slug}/settings/material-types`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}

      <MaterialTypesListClient types={types} usageCounts={usageCounts} orgSlug={slug} orgId={org.id} userId={userId} userRole={userRole} />
    </div>
  )
}
