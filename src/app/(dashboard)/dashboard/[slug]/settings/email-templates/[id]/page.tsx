import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveEmailTemplate, deleteEmailTemplate, cloneEmailTemplate } from '../actions'
import ImproveButton from './improve-button'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { STAFF_DEPARTMENTS } from '@/lib/staff-departments'

export const dynamic = 'force-dynamic'

const TRIGGER_EVENTS = [
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'quote_revised', label: 'Quote Revised' },
  { value: 'proof_sent', label: 'Proof Sent' },
  { value: 'order_confirmed', label: 'Order Confirmed' },
  { value: 'order_ready', label: 'Order Ready for Pickup' },
  { value: 'invoice_sent', label: 'Invoice Sent' },
  { value: 'payment_reminder', label: 'Payment Reminder' },
]

const VARIABLES = [
  '{{contact_name}}', '{{company_name}}', '{{txn_number}}',
  '{{job_name}}', '{{total}}', '{{due_date}}', '{{org_name}}',
]

type PageProps = {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{ edit?: string; error?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('email-template-detail', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug, id } = await params
  const sp = await searchParams
  const isNew = id === 'new'
  const editing = sp.edit === '1' || isNew
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  // Staff functional departments (Sales, Design, Production, ...) — the
  // same taxonomy stored in profiles.departments via Settings > Team, NOT
  // the job/product-category `departments` table.
  const departments = STAFF_DEPARTMENTS

  type Tmpl = { id: string; name: string; subject: string; body: string; trigger_event: string | null; is_active: boolean | null; department: string | null; ai_personalize: boolean | null }
  let t: Tmpl | null = null
  if (!isNew) {
    const data = await dbOrThrow(supabase.from('email_templates').select('id, name, subject, body, trigger_event, is_active, department, ai_personalize').eq('id', id).eq('organization_id', org.id).maybeSingle())
    t = data as unknown as Tmpl | null
    if (!t) return <div className="p-8 text-red-600">Template not found</div>
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/email-templates`} className="hover:text-gray-700">Email Templates</Link>
        <span>/</span>
        <span className="text-gray-700">{isNew ? 'New' : t?.name}</span>
      </div>

      {editing ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 mb-6">{isNew ? 'New Email Template' : 'Edit Template'}</h1>
          {sp.error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {decodeURIComponent(sp.error)}
            </div>
          )}
          <form id="email-template-form" action={saveEmailTemplate} className="space-y-4">
            {!isNew && <input type="hidden" name="id" value={t!.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div>
              <label className="block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" name="name" required defaultValue={t?.name ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Trigger Event</label>
              <select name="trigger_event" defaultValue={t?.trigger_event ?? 'manual'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="manual">— None (manual only) —</option>
                {TRIGGER_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select name="department" defaultValue={t?.department ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="">— Unassigned (visible to everyone) —</option>
                {departments.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-400">Controls which department sees this in the Send Email template picker. Owner/Admin always see every template.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Subject *</label>
              <input type="text" name="subject" required defaultValue={t?.subject ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
              <p className="mt-1 text-xs text-gray-400">Variables: {VARIABLES.join(', ')}</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">Body *</label>
                <ImproveButton textareaName="body" />
              </div>
              <textarea name="body" required rows={10} defaultValue={t?.body ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
              <p className="mt-1 text-xs text-gray-400">Variables: {VARIABLES.join(', ')}</p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="is_active" defaultChecked={t?.is_active !== false} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
              Active
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="ai_personalize" defaultChecked={t?.ai_personalize === true} className="h-4 w-4 rounded border-gray-300 accent-purple-600" />
              AI-personalize per order
              <span className="text-xs text-gray-400">— tailors the body to the specific order/customer at send time</span>
            </label>

          </form>
          <div className="flex gap-3 pt-2">
            <button type="submit" form="email-template-form" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
            <Link href={isNew ? `/dashboard/${slug}/settings/email-templates` : `/dashboard/${slug}/settings/email-templates/${id}`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            {!isNew && (
              <form action={deleteEmailTemplate} className="inline ml-auto">
                <input type="hidden" name="id" value={t!.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <button type="submit" className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">{t!.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {t!.trigger_event && (
                  <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {TRIGGER_EVENTS.find(e => e.value === t!.trigger_event)?.label ?? t!.trigger_event}
                  </span>
                )}
                <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {t!.department ? (departments.find(d => d.value === t!.department)?.label ?? t!.department) : 'Unassigned'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {t!.ai_personalize && (
                <span className="inline-block rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">AI-personalize</span>
              )}
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${t!.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {t!.is_active ? 'Active' : 'Inactive'}
              </span>
              <form action={cloneEmailTemplate}>
                <input type="hidden" name="id" value={t!.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <button type="submit" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Clone</button>
              </form>
              <Link href={`/dashboard/${slug}/settings/email-templates/${id}?edit=1`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Edit</Link>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Subject</span>
              <p className="mt-1 text-sm text-gray-900">{t!.subject}</p>
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Body</span>
              <div className="mt-1 rounded-lg bg-gray-50 p-4 text-sm text-gray-700 whitespace-pre-wrap">{t!.body}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
