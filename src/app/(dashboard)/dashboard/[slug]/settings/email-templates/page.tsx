import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const EVENT_LABELS: Record<string, string> = {
  quote_sent: 'Quote Sent', quote_revised: 'Quote Revised',
  proof_sent: 'Proof Sent', order_confirmed: 'Order Confirmed',
  order_ready: 'Order Ready', invoice_sent: 'Invoice Sent',
  payment_reminder: 'Payment Reminder',
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: rows } = await supabase
    .from('email_templates')
    .select('id, name, subject, trigger_event, is_active')
    .eq('organization_id', org.id)
    .order('name')
  const templates = (rows ?? []) as { id: string; name: string; subject: string; trigger_event: string | null; is_active: boolean | null }[]

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Email Templates</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Email Templates <span className="text-sm font-normal text-gray-400">({templates.length})</span></h1>
        <Link href={`/dashboard/${slug}/settings/email-templates/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          + New Template
        </Link>
      </div>

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
