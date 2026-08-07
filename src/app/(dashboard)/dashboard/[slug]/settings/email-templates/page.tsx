import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow, DbError } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { cloneEmailTemplate } from './actions'
import { STAFF_DEPARTMENTS } from '@/lib/staff-departments'

export const dynamic = 'force-dynamic'

const EVENT_LABELS: Record<string, string> = {
  quote_sent: 'Quote Sent', quote_revised: 'Quote Revised',
  proof_sent: 'Proof Sent', order_confirmed: 'Order Confirmed',
  order_ready: 'Order Ready', invoice_sent: 'Invoice Sent',
  payment_reminder: 'Payment Reminder',
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string; dept?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('email-templates', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc = sp.sort === 'desc'
  const deptFilter = sp.dept ?? 'all' // 'all' | 'unassigned' | a department code
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const [rowsData, countRes] = await Promise.all([
    dbOrThrow(
      supabase
        .from('email_templates')
        .select('id, name, subject, trigger_event, is_active, department, ai_personalize')
        .eq('organization_id', org.id)
        .order('name', { ascending: !sortDesc })
        .limit(1000)
    ),
    supabase
      .from('email_templates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  if (countRes.error) throw new DbError(countRes.error)
  const totalCount = countRes.count ?? 0
  type Row = { id: string; name: string; subject: string; trigger_event: string | null; is_active: boolean | null; department: string | null; ai_personalize: boolean | null }
  const allTemplates = (rowsData ?? []) as Row[]
  // Staff functional departments (Sales, Design, Production, ...) — the
  // same taxonomy stored in profiles.departments via Settings > Team, NOT
  // the job/product-category `departments` table. Must match exactly, or
  // department-based filtering (here and in the Send Email modal) never
  // matches anything for non-owner/admin users.
  const departments = STAFF_DEPARTMENTS
  const deptLabelByCode = new Map(departments.map(d => [d.value as string, d.label]))

  const tabCounts = {
    all: allTemplates.length,
    unassigned: allTemplates.filter(t => !t.department).length,
  } as Record<string, number>
  for (const d of departments) {
    tabCounts[d.value] = allTemplates.filter(t => t.department === d.value).length
  }

  const templates = deptFilter === 'all'
    ? allTemplates
    : deptFilter === 'unassigned'
    ? allTemplates.filter(t => !t.department)
    : allTemplates.filter(t => t.department === deptFilter)

  function buildHref(opts: { dept?: string; sortDesc?: boolean }) {
    const params = new URLSearchParams()
    const nextSortDesc = opts.sortDesc ?? sortDesc
    const nextDept = opts.dept ?? deptFilter
    if (nextSortDesc) params.set('sort', 'desc')
    if (nextDept !== 'all') params.set('dept', nextDept)
    const qs = params.toString()
    return `/dashboard/${slug}/settings/email-templates${qs ? `?${qs}` : ''}`
  }
  const tabHref = (dept: string) => buildHref({ dept })

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Email Templates</span>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Email Templates <span className="text-sm font-normal text-gray-400">({totalCount})</span></h1>
        <div className="flex items-center gap-2">
          <Link
            href={buildHref({ sortDesc: !sortDesc })}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link href={`/dashboard/${slug}/settings/email-templates/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            + New Template
          </Link>
        </div>
      </div>

      {/* Department quick-filter tabs — same pill pattern as the
          Enabled/Disabled/All tabs on Team Settings. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link
          href={tabHref('all')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            deptFilter === 'all' ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          All <span className="ml-1.5 text-xs text-qm-gray">({tabCounts.all})</span>
        </Link>
        <Link
          href={tabHref('unassigned')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            deptFilter === 'unassigned' ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          Unassigned <span className="ml-1.5 text-xs text-qm-gray">({tabCounts.unassigned})</span>
        </Link>
        {departments.map(d => (
          <Link
            key={d.value}
            href={tabHref(d.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              deptFilter === d.value ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {d.label} <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[d.value] ?? 0})</span>
          </Link>
        ))}
      </div>

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Department</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Trigger Event</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Subject</th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">AI</th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-400">No email templates in this view.</td></tr>
            ) : templates.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link href={`/dashboard/${slug}/settings/email-templates/${t.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{t.name}</Link>
                </td>
                <td className="px-6 py-3 text-sm text-gray-600">
                  {t.department ? (deptLabelByCode.get(t.department) ?? t.department) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-6 py-3 text-sm text-gray-600">
                  {t.trigger_event ? (
                    <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {EVENT_LABELS[t.trigger_event] ?? t.trigger_event}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-6 py-3 text-sm text-gray-500 max-w-xs truncate">{t.subject}</td>
                <td className="px-6 py-3 text-center">
                  {t.ai_personalize && (
                    <span className="inline-block rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700" title="AI-personalize per order is on">AI</span>
                  )}
                </td>
                <td className="px-6 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="px-6 py-3 text-right">
                  <form action={cloneEmailTemplate} className="inline">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="orgSlug" value={slug} />
                    <button type="submit" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                      Clone
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
