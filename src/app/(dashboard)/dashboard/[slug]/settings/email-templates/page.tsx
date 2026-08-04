import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow, DbError } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EVENT_LABELS: Record<string, string> = {
  quote_sent: 'Quote Sent', quote_revised: 'Quote Revised',
  proof_sent: 'Proof Sent', order_confirmed: 'Order Confirmed',
  order_ready: 'Order Ready', invoice_sent: 'Invoice Sent',
  payment_reminder: 'Payment Reminder',
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[email-templates] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (email-templates)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc = sp.sort === 'desc'
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const [rowsData, countRes] = await Promise.all([
    dbOrThrow(
      supabase
        .from('email_templates')
        .select('id, name, subject, trigger_event, is_active')
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
  const templates = (rowsData ?? []) as { id: string; name: string; subject: string; trigger_event: string | null; is_active: boolean | null }[]

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Email Templates</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Email Templates <span className="text-sm font-normal text-gray-400">({totalCount})</span></h1>
        <div className="flex items-center gap-2">
          <Link
            href={sortDesc ? `/dashboard/${slug}/settings/email-templates` : `/dashboard/${slug}/settings/email-templates?sort=desc`}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link href={`/dashboard/${slug}/settings/email-templates/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            + New Template
          </Link>
        </div>
      </div>

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Trigger Event</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Subject</th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.length === 0 ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-400">No email templates yet.</td></tr>
            ) : templates.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link href={`/dashboard/${slug}/settings/email-templates/${t.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{t.name}</Link>
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
                  <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
