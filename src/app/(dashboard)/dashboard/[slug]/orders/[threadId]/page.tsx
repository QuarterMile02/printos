import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { formatQuoteNumber } from '../../quotes/format'
import { formatSoNumber } from '../../sales-orders/format'
import { formatInvNumber } from '../../invoices/format'
import {
  type ActivityLogRow, groupActivityEntries, activityFieldLabel, resolveActivityFieldValue,
} from '@/lib/activity-log-display'

// Centralized order-lifecycle audit view (migration 132).
//
// Keyed by activity_log.order_thread_id — per the migration's own
// definition, that id is directly a quotes.id (the originating quote) or,
// for orders with no quote, a sales_orders.id. So the whole quote → SO →
// jobs → invoices chain can be resolved with a handful of targeted
// queries instead of a generic graph walk.
//
// SCOPE NOTE: this is the view only. order_thread_id is populated today
// only by the invoice unpost/edit/repost/field-changed actions — quote,
// sales-order, job, proof, and most invoice events (recordPayment's
// marked_paid, the quote→SO→job conversion moment) don't stamp it yet.
// Backfilling historical rows and wiring the remaining logActivity() call
// sites is a separate, later task — this page renders whatever's there
// honestly, including an explanatory empty state, rather than pretending
// the trail is complete.

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; threadId: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('order-thread-detail', err)
  }
}

type ChainQuote = { id: string; quote_number: number; created_at: string }
type ChainSO = { id: string; so_number: number; created_at: string }
type ChainJob = { id: string; job_number: number }
type ChainInvoice = { id: string; invoice_number: number; created_at: string }

async function resolveOrderChain(
  supabase: Awaited<ReturnType<typeof createClient>>, threadId: string, orgId: string,
): Promise<{ quote: ChainQuote | null; sos: ChainSO[]; jobs: ChainJob[]; invoices: ChainInvoice[] }> {
  const quote = await dbOrThrow(
    supabase.from('quotes').select('id, quote_number, created_at').eq('id', threadId).eq('organization_id', orgId).maybeSingle()
  ) as ChainQuote | null

  // order_thread_id is meant to anchor one quote to at most one SO (per
  // migration 132's design comment), but real data in this org has
  // several sales orders sharing the same quote_id (checked live — not a
  // theoretical case). .maybeSingle() throws on >1 rows, so fetch all
  // matches and render the fan-out honestly rather than assuming 1:1.
  let sos: ChainSO[] = []
  if (quote) {
    sos = (await dbOrThrow(
      supabase.from('sales_orders').select('id, so_number, created_at').eq('quote_id', threadId).eq('organization_id', orgId).order('so_number')
    ) ?? []) as ChainSO[]
  } else {
    const so = await dbOrThrow(
      supabase.from('sales_orders').select('id, so_number, created_at').eq('id', threadId).eq('organization_id', orgId).maybeSingle()
    ) as ChainSO | null
    if (so) sos = [so]
  }

  // jobs.source_quote_id and jobs.sales_order_id are both set at creation
  // (convert-action.ts) — key off whichever anchor we actually have. When
  // there's a quote, one query covers jobs under any/all of its SOs.
  let jobs: ChainJob[] = []
  if (quote) {
    jobs = (await dbOrThrow(
      supabase.from('jobs').select('id, job_number').eq('source_quote_id', threadId).eq('organization_id', orgId).order('job_number')
    ) ?? []) as ChainJob[]
  } else if (sos[0]) {
    jobs = (await dbOrThrow(
      supabase.from('jobs').select('id, job_number').eq('sales_order_id', sos[0].id).eq('organization_id', orgId).order('job_number')
    ) ?? []) as ChainJob[]
  }

  const invoices = sos.length
    ? (await dbOrThrow(
        supabase.from('invoices').select('id, invoice_number, created_at').in('sales_order_id', sos.map((s) => s.id)).eq('organization_id', orgId).order('invoice_number')
      ) ?? []) as ChainInvoice[]
    : []

  return { quote, sos, jobs, invoices }
}

// Same switch as _widgets/recent-activity.tsx's entityHref — kept local
// since that widget isn't a shared module, matching this codebase's
// existing convention of each page inlining its own lookups.
function entityHref(orgSlug: string, type: string, id: string): string | null {
  const base = `/dashboard/${orgSlug}`
  switch (type) {
    case 'quote':       return `${base}/quotes/${id}`
    case 'sales_order': return `${base}/sales-orders/${id}`
    case 'job':         return `${base}/jobs/${id}`
    case 'invoice':     return `${base}/invoices/${id}`
    case 'customer':    return `${base}/customers/${id}`
    default:            return null
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, threadId } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const chain = await resolveOrderChain(supabase, threadId, org.id)
  if (!chain.quote && chain.sos.length === 0) {
    return <div className="p-8 text-red-600">Order thread not found.</div>
  }

  const logRows = (await dbOrThrow(
    supabase
      .from('activity_log')
      .select('id, user_id, entity_type, entity_id, action, from_value, to_value, field_name, change_group_id, created_at')
      .eq('organization_id', org.id)
      .eq('order_thread_id', threadId)
      .order('created_at', { ascending: true })
  ) ?? []) as ActivityLogRow[]

  const entries = groupActivityEntries(logRows)

  const userIds = Array.from(new Set(logRows.map((r) => r.user_id).filter((v): v is string => !!v)))
  const profileRows = userIds.length
    ? (await dbOrThrow(supabase.from('profiles').select('id, full_name').in('id', userIds)) ?? []) as { id: string; full_name: string | null }[]
    : []
  const nameById = new Map(profileRows.map((p) => [p.id, p.full_name]))

  // customer_id/contact_id field diffs store raw UUIDs — batch-resolve
  // every id that appears as a from/to value on those specific fields so
  // the diff lines read as names, same as every other field already does.
  const customerIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const r of logRows) {
    if (r.field_name === 'customer_id') { if (r.from_value) customerIds.add(r.from_value); if (r.to_value) customerIds.add(r.to_value) }
    if (r.field_name === 'contact_id') { if (r.from_value) contactIds.add(r.from_value); if (r.to_value) contactIds.add(r.to_value) }
  }
  const customerNameById = new Map<string, string>()
  if (customerIds.size) {
    const rows = (await dbOrThrow(
      supabase.from('customers').select('id, first_name, last_name, company_name').in('id', Array.from(customerIds))
    ) ?? []) as { id: string; first_name: string; last_name: string; company_name: string | null }[]
    for (const c of rows) customerNameById.set(c.id, c.company_name || `${c.first_name} ${c.last_name}`.trim())
  }
  const contactNameById = new Map<string, string>()
  if (contactIds.size) {
    const rows = (await dbOrThrow(
      supabase.from('customer_contacts').select('id, full_name').in('id', Array.from(contactIds))
    ) ?? []) as { id: string; full_name: string }[]
    for (const c of rows) contactNameById.set(c.id, c.full_name)
  }

  // Human-readable labels for entities that are part of this resolved
  // chain — anything else (a proof, a customer, a stale/deleted entity)
  // falls back to a generic entity-type label with no special number.
  const entityLabel = new Map<string, string>()
  if (chain.quote) entityLabel.set(`quote:${chain.quote.id}`, formatQuoteNumber(chain.quote.quote_number, chain.quote.created_at))
  for (const so of chain.sos) entityLabel.set(`sales_order:${so.id}`, formatSoNumber(so.so_number, so.created_at))
  for (const j of chain.jobs) entityLabel.set(`job:${j.id}`, `JOB-${String(j.job_number).padStart(4, '0')}`)
  for (const inv of chain.invoices) entityLabel.set(`invoice:${inv.id}`, formatInvNumber(inv.invoice_number, inv.created_at))

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Order History</span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold text-gray-900">Order History</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {chain.quote && (
            <Link href={`/dashboard/${slug}/quotes/${chain.quote.id}`} className="text-qm-fuchsia hover:underline font-semibold">
              {formatQuoteNumber(chain.quote.quote_number, chain.quote.created_at)}
            </Link>
          )}
          {chain.quote && chain.sos.length > 0 && <span className="text-gray-300">→</span>}
          {chain.sos.map((so, i) => (
            <span key={so.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-300">,</span>}
              <Link href={`/dashboard/${slug}/sales-orders/${so.id}`} className="text-qm-fuchsia hover:underline font-semibold">
                {formatSoNumber(so.so_number, so.created_at)}
              </Link>
            </span>
          ))}
          {chain.sos.length > 0 && chain.jobs.length > 0 && <span className="text-gray-300">→</span>}
          {chain.jobs.map((j, i) => (
            <span key={j.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-300">,</span>}
              <Link href={`/dashboard/${slug}/jobs/${j.id}`} className="text-qm-fuchsia hover:underline font-semibold">
                JOB-{String(j.job_number).padStart(4, '0')}
              </Link>
            </span>
          ))}
          {chain.invoices.length > 0 && (chain.jobs.length > 0 || chain.sos.length > 0) && <span className="text-gray-300">→</span>}
          {chain.invoices.map((inv, i) => (
            <span key={inv.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-gray-300">,</span>}
              <Link href={`/dashboard/${slug}/invoices/${inv.id}`} className="text-qm-fuchsia hover:underline font-semibold">
                {formatInvNumber(inv.invoice_number, inv.created_at)}
              </Link>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Activity</h2>
        </div>
        {entries.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-gray-400">No activity logged for this order yet.</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-gray-400">
              order_thread_id is only populated by the invoice unpost/edit/repost flow so far —
              quote, sales order, job, and other invoice events aren&apos;t tagged until the
              backfill pass runs.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((e) => {
              const label = entityLabel.get(`${e.entity_type}:${e.entity_id}`) ?? e.entity_type.replace(/_/g, ' ')
              const href = entityHref(slug, e.entity_type, e.entity_id)
              const who = e.user_id ? (nameById.get(e.user_id) ?? 'Unknown user') : 'System'
              return (
                <li key={e.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                          {e.entity_type.replace(/_/g, ' ')}
                        </span>
                        {href ? (
                          <Link href={href} className="text-xs font-semibold text-qm-fuchsia hover:underline">{label}</Link>
                        ) : (
                          <span className="text-xs font-semibold text-gray-500">{label}</span>
                        )}
                      </div>
                      {e.kind === 'status' ? (
                        <p className="mt-1 text-sm text-gray-900">{e.summary}</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {e.fields.map((f, i) => {
                            const from = resolveActivityFieldValue(f.field, f.from, customerNameById, contactNameById)
                            const to = resolveActivityFieldValue(f.field, f.to, customerNameById, contactNameById)
                            return (
                              <li key={i} className="text-sm text-gray-900">
                                <span className="font-medium">{activityFieldLabel(f.field)}:</span>{' '}
                                {from ? <span className="text-gray-500">{from}</span> : <span className="italic text-gray-400">empty</span>}
                                {' → '}
                                {to ? <span>{to}</span> : <span className="italic text-gray-400">empty</span>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-gray-400">by {who}</p>
                    </div>
                    <span className="shrink-0 text-xs text-gray-500 tabular-nums">
                      {new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
