import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveCustomNote } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'

export const dynamic = 'force-dynamic'

const TYPES = [
  { value: 'customer_note',    label: 'Customer Note'    },
  { value: 'quote_note',       label: 'Quote Note'       },
  { value: 'sales_order_note', label: 'Sales Order Note' },
  { value: 'invoice_note',     label: 'Invoice Note'     },
  { value: 'job_note',         label: 'Job Note'         },
  { value: 'void_reason',      label: 'Void Reason'      },
  { value: 'lost_reason',      label: 'Lost Reason'      },
]

const TABS = [
  { label: 'All',          value: '' },
  { label: 'Customer',     value: 'customer_note' },
  { label: 'Quote',        value: 'quote_note' },
  { label: 'Sales Order',  value: 'sales_order_note' },
  { label: 'Invoice',      value: 'invoice_note' },
  { label: 'Job',          value: 'job_note' },
]

const TYPE_BADGE: Record<string, string> = {
  void_reason:      'bg-red-50    text-red-700',
  lost_reason:      'bg-orange-50 text-orange-700',
  customer_note:    'bg-blue-50   text-blue-700',
  job_note:         'bg-amber-50  text-amber-700',
  quote_note:       'bg-purple-50 text-purple-700',
  sales_order_note: 'bg-teal-50   text-teal-700',
  invoice_note:     'bg-indigo-50 text-indigo-700',
}

const TYPE_LABEL: Record<string, string> = {
  void_reason:      'Void Reason',
  lost_reason:      'Lost Reason',
  customer_note:    'Customer Note',
  job_note:         'Job Note',
  quote_note:       'Quote Note',
  sales_order_note: 'Sales Order Note',
  invoice_note:     'Invoice Note',
}

type Note = {
  id: string
  title: string
  body: string
  type: string
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; type?: string; sort?: string; search?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[custom-notes] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (custom-notes)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc  = sp.sort === 'desc'
  const typeFilter = sp.type ?? ''
  const search = (sp.search ?? '').trim().toLowerCase()
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.custom_notes')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Custom Notes</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage custom notes. Contact your organization owner.
        </div>
      </div>
    )
  }

  // Fetch all notes — tab filtering is done in-memory below
  const { data: allRes } = await supabase
    .from('custom_notes')
    .select('id, title, body, type, is_active, created_at')
    .eq('organization_id', org.id)
    .order('title', { ascending: !sortDesc })

  const allNotes = (allRes ?? []) as Note[]
  let notes = typeFilter ? allNotes.filter((n) => n.type === typeFilter) : allNotes
  if (search) notes = notes.filter((n) => n.title.toLowerCase().includes(search) || n.body.toLowerCase().includes(search))

  const editId  = sp.edit
  const showAdd = sp.add === '1'

  let editNote: Note | null = null
  if (editId) {
    editNote = notes.find((n) => n.id === editId) ?? null
    if (!editNote) {
      const { data: found } = await supabase
        .from('custom_notes')
        .select('id, title, body, type, is_active, created_at')
        .eq('id', editId).eq('organization_id', org.id).single()
      editNote = (found as Note | null)
    }
  }

  const isPanelOpen = Boolean(editNote || showAdd)

  // Helper: build URL preserving sort + type params
  function buildUrl(overrides: { type?: string; add?: string; edit?: string; saved?: string } = {}) {
    const params = new URLSearchParams()
    if (sortDesc) params.set('sort', 'desc')
    if (sp.search) params.set('search', sp.search)
    const type = 'type' in overrides ? overrides.type : typeFilter
    if (type) params.set('type', type)
    if (overrides.add)   params.set('add', overrides.add)
    if (overrides.edit)  params.set('edit', overrides.edit)
    if (overrides.saved) params.set('saved', overrides.saved)
    const qs = params.toString()
    return `/dashboard/${slug}/settings/custom-notes${qs ? `?${qs}` : ''}`
  }

  const sortToggleUrl = (() => {
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)
    if (sp.search) params.set('search', sp.search)
    if (!sortDesc) params.set('sort', 'desc')
    const qs = params.toString()
    return `/dashboard/${slug}/settings/custom-notes${qs ? `?${qs}` : ''}`
  })()

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Custom Notes</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Custom Notes <span className="text-sm font-normal text-gray-400">({notes.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={sortToggleUrl}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              !sortDesc
                ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700'
                : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            {sortDesc ? 'Z–A ↓' : 'A–Z ↑'}
          </Link>
          <Link
            href={buildUrl({ add: '1' })}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Note
          </Link>
        </div>
      </div>

      {/* Search */}
      <form className="mb-4">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        <input
          type="text"
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Search by title or body..."
          className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </form>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        {TABS.map((tab) => {
          const isActive = typeFilter === tab.value
          const tabParams = new URLSearchParams()
          if (sortDesc) tabParams.set('sort', 'desc')
          if (sp.search) tabParams.set('search', sp.search)
          if (tab.value) tabParams.set('type', tab.value)
          const qs = tabParams.toString()
          return (
            <Link
              key={tab.value}
              href={`/dashboard/${slug}/settings/custom-notes${qs ? `?${qs}` : ''}`}
              className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Inline add / edit panel */}
      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editNote ? 'Edit Note' : 'New Custom Note'}
          </h2>
          <form action={saveCustomNote} className="space-y-4">
            {editNote && <input type="hidden" name="id" value={editNote.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Title *</label>
                <input
                  type="text" name="title" required
                  defaultValue={editNote?.title ?? ''}
                  placeholder="e.g. Net 30"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Type *</label>
                <select
                  name="type" required
                  defaultValue={editNote?.type ?? (typeFilter || 'quote_note')}
                  className={inputCls}
                >
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={labelCls}>Body *</label>
              <textarea
                name="body" required rows={4}
                defaultValue={editNote?.body ?? ''}
                placeholder="Enter the note text that will appear as a quick-fill option…"
                className={inputCls + ' resize-y'}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" name="is_active"
                defaultChecked={editNote?.is_active !== false}
                className="h-4 w-4 accent-qm-lime"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit"
                className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
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

      {/* Note list table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Body Preview</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 ${STICKY_ACTIONS_TH}`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {notes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search
                    ? `No notes match "${sp.search}".`
                    : typeFilter
                    ? `No ${TYPE_LABEL[typeFilter] ?? typeFilter}s yet.`
                    : 'No custom notes yet.'}
                </td>
              </tr>
            ) : notes.map((n) => (
              <tr key={n.id} className="group hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link
                    href={buildUrl({ edit: n.id })}
                    className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia"
                  >
                    {n.title}
                  </Link>
                </td>
                <td className="px-4 py-3 max-w-xs">
                  <p className="text-sm text-gray-500 truncate">{n.body}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    TYPE_BADGE[n.type] ?? 'bg-gray-100 text-gray-600'
                  }`}>
                    {TYPE_LABEL[n.type] ?? n.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${n.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_ACTIONS_TD}`}>
                  <Link href={buildUrl({ edit: n.id })} className="text-sm text-qm-lime hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Custom notes appear as quick-fill dropdowns on quotes, sales orders, and jobs. Deactivate a note to hide it from new selections.
      </p>
    </div>
  )
}
