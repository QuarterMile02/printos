import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveGeneralCategory } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import GeneralCategoriesListClient, { type CategoryRow } from './general-categories-list-client'

export const dynamic = 'force-dynamic'

const TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'job',   label: 'Job'   },
  { value: 'quote', label: 'Quote' },
  { value: 'all',   label: 'All'   },
]

const SUBTYPES = [
  { value: 'asset',         label: 'Asset'         },
  { value: 'industry',      label: 'Industry'      },
  { value: 'lead_source',   label: 'Lead Source'   },
  { value: 'machine',       label: 'Machine'       },
  { value: 'note',          label: 'Note'          },
  { value: 'pricing_level', label: 'Pricing Level' },
  { value: 'tag',           label: 'Tag'           },
]

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[general-categories] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (general-categories)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
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

  const { allowed } = await checkPermission(org.id, 'settings.general_categories')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">General Categories</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage general categories. Contact your organization owner.
        </div>
      </div>
    )
  }

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const { data: allRes } = await supabase
    .from('general_categories')
    .select('id, name, type, sub_type, is_active, created_at')
    .eq('organization_id', org.id)
    .order('name', { ascending: true })

  type Category = CategoryRow & { created_at: string }
  const allCategories = (allRes ?? []) as Category[]

  const editId = sp.edit
  const showAdd = sp.add === '1'

  let editCategory: Category | null = null
  if (editId) {
    editCategory = allCategories.find(c => c.id === editId) ?? null
    if (!editCategory) {
      const { data: found } = await supabase
        .from('general_categories')
        .select('id, name, type, sub_type, is_active, created_at')
        .eq('id', editId)
        .eq('organization_id', org.id)
        .single()
      editCategory = (found as Category | null)
    }
  }

  const isPanelOpen = Boolean(editCategory || showAdd)

  function buildUrl(overrides: { add?: string; edit?: string; saved?: string } = {}) {
    const p = new URLSearchParams()
    if (overrides.add)   p.set('add', overrides.add)
    if (overrides.edit)  p.set('edit', overrides.edit)
    if (overrides.saved) p.set('saved', overrides.saved)
    const qs = p.toString()
    return `/dashboard/${slug}/settings/general-categories${qs ? `?${qs}` : ''}`
  }

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">General Categories</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">
          General Categories <span className="text-sm font-normal text-gray-400">({allCategories.length})</span>
        </h1>
        <Link
          href={buildUrl({ add: '1' })}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Category
        </Link>
      </div>

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
            {editCategory ? 'Edit Category' : 'New General Category'}
          </h2>
          <form action={saveGeneralCategory} className="space-y-4">
            {editCategory && <input type="hidden" name="id" value={editCategory.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Name *</label>
                <input type="text" name="name" required defaultValue={editCategory?.name ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Applies To *</label>
                <select name="type" required defaultValue={editCategory?.type ?? 'all'} className={inputCls}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Sub-Type</label>
                <select name="sub_type" defaultValue={editCategory?.sub_type ?? ''} className={inputCls}>
                  <option value="">— None —</option>
                  {SUBTYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editCategory?.is_active !== false}
                className="h-4 w-4 accent-qm-lime"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Save
              </button>
              <Link
                href={buildUrl()}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}

      <GeneralCategoriesListClient categories={allCategories} orgSlug={slug} orgId={org.id} userId={userId} userRole={userRole} />

      <p className="mt-3 text-xs text-gray-400">
        Categories are used to tag quotes, jobs, and assets. Deactivate a category to hide it from new selections.
      </p>
    </div>
  )
}
