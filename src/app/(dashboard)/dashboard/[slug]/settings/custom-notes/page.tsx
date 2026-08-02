import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveCustomNote } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import CustomNotesListClient, { type NoteRow } from './custom-notes-list-client'

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

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const { data: allRes } = await supabase
    .from('custom_notes')
    .select('id, title, body, type, is_active, created_at')
    .eq('organization_id', org.id)
    .order('title', { ascending: true })

  type Note = NoteRow & { created_at: string }
  const allNotes = (allRes ?? []) as Note[]

  const editId = sp.edit
  const showAdd = sp.add === '1'

  let editNote: Note | null = null
  if (editId) {
    editNote = allNotes.find((n) => n.id === editId) ?? null
    if (!editNote) {
      const { data: found } = await supabase
        .from('custom_notes')
        .select('id, title, body, type, is_active, created_at')
        .eq('id', editId).eq('organization_id', org.id).single()
      editNote = (found as Note | null)
    }
  }

  const isPanelOpen = Boolean(editNote || showAdd)

  function buildUrl(overrides: { add?: string; edit?: string; saved?: string } = {}) {
    const params = new URLSearchParams()
    if (overrides.add)   params.set('add', overrides.add)
    if (overrides.edit)  params.set('edit', overrides.edit)
    if (overrides.saved) params.set('saved', overrides.saved)
    const qs = params.toString()
    return `/dashboard/${slug}/settings/custom-notes${qs ? `?${qs}` : ''}`
  }

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Custom Notes</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Custom Notes <span className="text-sm font-normal text-gray-400">({allNotes.length})</span>
        </h1>
        <Link
          href={buildUrl({ add: '1' })}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Note
        </Link>
      </div>

      {/* Inline add / edit panel */}
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
                  defaultValue={editNote?.type ?? 'quote_note'}
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

      <CustomNotesListClient notes={allNotes} orgSlug={slug} orgId={org.id} userId={userId} userRole={userRole} />

      <p className="mt-3 text-xs text-gray-400">
        Custom notes appear as quick-fill dropdowns on quotes, sales orders, and jobs. Deactivate a note to hide it from new selections.
      </p>
    </div>
  )
}
