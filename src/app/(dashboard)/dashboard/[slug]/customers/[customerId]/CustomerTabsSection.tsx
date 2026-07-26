'use client'

import { useState, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type OpenJobRow = { id: string; job_number: number; title: string; status: string; created_at: string }
type QuoteRow = { id: string; quote_number: number; title: string; status: string; total: number; created_at: string }
type InvoiceRow = { id: string; invoice_number: number; status: string; total: number; due_date: string | null; created_at: string }
type TxRow = { id: string; type: 'QT' | 'SO' | 'IN'; record_number: number; title: string | null; total: number; status: string; created_at: string; due_date?: string | null }
type PayRow = { id: string; payment_number: number; invoice_id: string | null; amount_paid: number; payment_method: string | null; balance: number | null; applied: boolean | null; paid_on: string | null; note: string | null; created_at: string }
type TaskRow = { id: string; title: string; status: string; due_date: string | null; created_at: string }
type LeadRow = { id: string; title: string; estimated_value: number | null; created_at: string }

type Tab = 'jobs' | 'quotes' | 'invoices' | 'transactions' | 'payments' | 'tasks' | 'leads' | 'contacts'

type Props = {
  customerId: string
  orgSlug: string
  initialOpenJobs: OpenJobRow[]
  initialQuotes: QuoteRow[]
  initialInvoices: InvoiceRow[]
  contactsSlot: React.ReactNode
  contactCount: number
}

// ── Style maps ─────────────────────────────────────────────────────────────────

const JOB_COLORS: Record<string, string> = {
  new: 'bg-qm-lime-light text-qm-lime',
  in_progress: 'bg-qm-fuchsia-light text-qm-fuchsia',
  proof_review: 'bg-qm-gray-light text-qm-gray',
  ready_for_pickup: 'bg-qm-black/5 text-qm-black',
  completed: 'bg-qm-lime-light text-qm-lime',
}
const JOB_LABELS: Record<string, string> = {
  new: 'New', in_progress: 'In Progress', proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
}
const QUOTE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-50 text-blue-700',
  accepted: 'bg-qm-lime-light text-qm-lime-dark', declined: 'bg-red-50 text-red-700',
  expired: 'bg-gray-100 text-gray-500', converted: 'bg-purple-50 text-purple-700',
}
const INV_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-50 text-blue-700',
  paid: 'bg-qm-lime-light text-qm-lime-dark', partial: 'bg-yellow-50 text-yellow-700',
  overdue: 'bg-red-50 text-red-700', void: 'bg-gray-100 text-gray-400',
}
const TX_BADGE: Record<string, string> = {
  QT: 'bg-blue-50 text-blue-700',
  SO: 'bg-purple-50 text-purple-700',
  IN: 'bg-yellow-50 text-yellow-700',
}
const TASK_COLORS: Record<string, string> = {
  open: 'bg-yellow-50 text-yellow-700',
  in_progress: 'bg-blue-50 text-blue-700',
  done: 'bg-qm-lime-light text-qm-lime-dark',
}
const TASK_LABELS: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', done: 'Done',
}
const PAYMENT_METHODS = ['Cash', 'Check', 'Credit Card', 'ACH', 'Wire Transfer', 'Other']

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-qm-lime" />
    </div>
  )
}
function Empty({ msg }: { msg: string }) {
  return <p className="px-6 py-10 text-center text-sm text-qm-gray">{msg}</p>
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const sc = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

// ── Component ──────────────────────────────────────────────────────────────────

export default function CustomerTabsSection({
  customerId, orgSlug, initialOpenJobs, initialQuotes, initialInvoices,
  contactsSlot, contactCount,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('transactions')

  // Lazy-loaded data (null = not yet fetched)
  const [transactions, setTransactions] = useState<TxRow[] | null>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [payments, setPayments] = useState<PayRow[] | null>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [tasks, setTasks] = useState<TaskRow[] | null>(null)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [leads, setLeads] = useState<LeadRow[] | null>(null)
  const [leadsLoading, setLeadsLoading] = useState(false)

  // Payment log form
  const [showPayForm, setShowPayForm] = useState(false)
  const [payDraft, setPayDraft] = useState({ amount: '', method: 'Credit Card', paid_on: '', note: '' })
  const [payError, setPayError] = useState<string | null>(null)
  const [paySaving, setPaySaving] = useState(false)

  useEffect(() => {
    if (activeTab === 'transactions' && transactions === null && !txLoading) {
      setTxLoading(true)
      fetch(`/api/customers/${customerId}/transactions`)
        .then((r) => r.json()).then((d) => { setTransactions(Array.isArray(d) ? d : []); setTxLoading(false) })
        .catch(() => { setTransactions([]); setTxLoading(false) })
    }
    if (activeTab === 'payments' && payments === null && !payLoading) {
      setPayLoading(true)
      fetch(`/api/customers/${customerId}/payments`)
        .then((r) => r.json()).then((d) => { setPayments(Array.isArray(d) ? d : []); setPayLoading(false) })
        .catch(() => { setPayments([]); setPayLoading(false) })
    }
    if (activeTab === 'tasks' && tasks === null && !tasksLoading) {
      setTasksLoading(true)
      fetch(`/api/customers/${customerId}/tasks`)
        .then((r) => r.json()).then((d) => { setTasks(Array.isArray(d) ? d : []); setTasksLoading(false) })
        .catch(() => { setTasks([]); setTasksLoading(false) })
    }
    if (activeTab === 'leads' && leads === null && !leadsLoading) {
      setLeadsLoading(true)
      fetch(`/api/customers/${customerId}/leads`)
        .then((r) => r.json()).then((d) => { setLeads(Array.isArray(d) ? d : []); setLeadsLoading(false) })
        .catch(() => { setLeads([]); setLeadsLoading(false) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  async function logPayment() {
    const dollars = parseFloat(payDraft.amount)
    if (isNaN(dollars) || dollars <= 0) { setPayError('Enter a valid amount.'); return }
    setPayError(null)
    setPaySaving(true)
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          amount_paid: Math.round(dollars * 100),
          payment_method: payDraft.method || null,
          paid_on: payDraft.paid_on || null,
          note: payDraft.note || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setPayError(data.error ?? 'Save failed'); return }
      setPayments((prev) => [data, ...(prev ?? [])])
      setPayDraft({ amount: '', method: 'Credit Card', paid_on: '', note: '' })
      setShowPayForm(false)
    } catch (e) {
      setPayError('Network error')
    } finally {
      setPaySaving(false)
    }
  }

  // ── Tab definitions ────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'transactions', label: 'Transactions' },
    { key: 'payments', label: 'Payments', count: payments?.length },
    { key: 'contacts', label: 'Contacts', count: contactCount },
    { key: 'jobs', label: 'Open Jobs', count: initialOpenJobs.length },
    { key: 'quotes', label: 'Quotes', count: initialQuotes.length },
    { key: 'invoices', label: 'Invoices', count: initialInvoices.length },
    { key: 'tasks', label: 'Tasks', count: tasks?.length },
    { key: 'leads', label: 'Sales Leads', count: leads?.length },
  ]

  // ── Tab content ────────────────────────────────────────────────────────────

  function renderJobs() {
    if (initialOpenJobs.length === 0) return <Empty msg="No open jobs" />
    return (
      <div className="divide-y divide-gray-50">
        {initialOpenJobs.map((j) => (
          <a key={j.id} href={`/dashboard/${orgSlug}/jobs/${j.id}`}
            className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-qm-gray">#{j.job_number}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_COLORS[j.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {JOB_LABELS[j.status] ?? j.status}
                </span>
              </div>
              <p className="text-sm font-medium text-qm-black truncate">{j.title}</p>
            </div>
            <span className="ml-4 shrink-0 text-xs text-qm-gray">{formatDate(j.created_at)}</span>
          </a>
        ))}
      </div>
    )
  }

  function renderQuotes() {
    if (initialQuotes.length === 0) return <Empty msg="No quotes for this customer" />
    return (
      <div className="divide-y divide-gray-50">
        {initialQuotes.map((q) => (
          <a key={q.id} href={`/dashboard/${orgSlug}/quotes/${q.id}`}
            className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-qm-gray">Q-{q.quote_number}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${QUOTE_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {q.status}
                </span>
              </div>
              <p className="text-sm font-medium text-qm-black truncate">{q.title}</p>
            </div>
            <div className="ml-4 shrink-0 text-right">
              <p className="text-sm font-semibold text-qm-black">${formatCents(q.total)}</p>
              <p className="text-xs text-qm-gray">{formatDate(q.created_at)}</p>
            </div>
          </a>
        ))}
      </div>
    )
  }

  function renderInvoices() {
    if (initialInvoices.length === 0) return <Empty msg="No invoices for this customer" />
    return (
      <div className="divide-y divide-gray-50">
        {initialInvoices.map((inv) => (
          <a key={inv.id} href={`/dashboard/${orgSlug}/invoices/${inv.id}`}
            className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-qm-gray">INV-{inv.invoice_number}</span>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${INV_COLORS[inv.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {inv.status}
                </span>
              </div>
              {inv.due_date && <p className="text-xs text-qm-gray">Due {formatDate(inv.due_date)}</p>}
            </div>
            <div className="ml-4 shrink-0 text-right">
              <p className="text-sm font-semibold text-qm-black">${formatCents(inv.total ?? 0)}</p>
              <p className="text-xs text-qm-gray">{formatDate(inv.created_at)}</p>
            </div>
          </a>
        ))}
      </div>
    )
  }

  function renderTransactions() {
    if (txLoading) return <Spinner />
    if (!transactions || transactions.length === 0) return <Empty msg="No transactions yet" />
    return (
      <div className="divide-y divide-gray-50">
        {transactions.map((tx) => {
          const href = tx.type === 'QT'
            ? `/dashboard/${orgSlug}/quotes/${tx.id}`
            : tx.type === 'SO'
            ? `/dashboard/${orgSlug}/sales-orders/${tx.id}`
            : `/dashboard/${orgSlug}/invoices/${tx.id}`
          const label = tx.type === 'IN'
            ? `INV-${tx.record_number}`
            : tx.type === 'QT'
            ? `Q-${tx.record_number}`
            : `SO-${tx.record_number}`
          return (
            <a key={`${tx.type}-${tx.id}`} href={href}
              className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${TX_BADGE[tx.type]}`}>
                    {tx.type}
                  </span>
                  <span className="text-xs font-semibold text-qm-gray">{label}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                    tx.type === 'QT' ? (QUOTE_COLORS[tx.status] ?? 'bg-gray-100 text-gray-600') :
                    tx.type === 'IN' ? (INV_COLORS[tx.status] ?? 'bg-gray-100 text-gray-600') :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {tx.status}
                  </span>
                </div>
                {tx.title && <p className="text-sm font-medium text-qm-black truncate">{tx.title}</p>}
              </div>
              <div className="ml-4 shrink-0 text-right">
                <p className="text-sm font-semibold text-qm-black">${formatCents(tx.total ?? 0)}</p>
                <p className="text-xs text-qm-gray">{formatDate(tx.created_at)}</p>
              </div>
            </a>
          )
        })}
      </div>
    )
  }

  function renderPayments() {
    return (
      <>
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
          <span className="text-xs text-qm-gray font-medium">{payments?.length ?? '…'} payments</span>
          <button
            onClick={() => { setShowPayForm((v) => !v); setPayError(null) }}
            className="inline-flex items-center gap-1.5 rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Log Payment
          </button>
        </div>

        {showPayForm && (
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 space-y-3">
            {payError && <div className="rounded-md bg-red-50 border border-red-200 p-2 text-sm text-red-700">{payError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount ($) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={payDraft.amount}
                  onChange={(e) => setPayDraft({ ...payDraft, amount: e.target.value })} className={ic} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
                <select value={payDraft.method} onChange={(e) => setPayDraft({ ...payDraft, method: e.target.value })} className={sc}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date paid</label>
              <input type="date" value={payDraft.paid_on}
                onChange={(e) => setPayDraft({ ...payDraft, paid_on: e.target.value })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Note</label>
              <input type="text" placeholder="Check #, reference, etc." value={payDraft.note}
                onChange={(e) => setPayDraft({ ...payDraft, note: e.target.value })} className={ic} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowPayForm(false); setPayError(null) }} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
              <button onClick={logPayment} disabled={paySaving} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {paySaving ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        )}

        {payLoading ? <Spinner /> : !payments || payments.length === 0 ? (
          <Empty msg="No payments recorded" />
        ) : (
          <div className="divide-y divide-gray-50">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-qm-gray">#{p.payment_number}</span>
                    {p.payment_method && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {p.payment_method}
                      </span>
                    )}
                    {p.applied && (
                      <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2 py-0.5 text-xs font-semibold text-qm-lime-dark">
                        Applied
                      </span>
                    )}
                  </div>
                  {p.note && <p className="text-xs text-qm-gray truncate">{p.note}</p>}
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className="text-sm font-semibold text-qm-black">${formatCents(p.amount_paid ?? 0)}</p>
                  <p className="text-xs text-qm-gray">{p.paid_on ? formatDate(p.paid_on) : formatDate(p.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  function renderTasks() {
    if (tasksLoading) return <Spinner />
    if (!tasks || tasks.length === 0) return <Empty msg="No tasks linked to this customer" />
    return (
      <div className="divide-y divide-gray-50">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-6 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TASK_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {TASK_LABELS[t.status] ?? t.status}
                </span>
              </div>
              <p className="text-sm font-medium text-qm-black truncate">{t.title}</p>
            </div>
            <div className="ml-4 shrink-0 text-right">
              {t.due_date && <p className="text-xs text-qm-gray">Due {formatDate(t.due_date)}</p>}
              <p className="text-xs text-qm-gray">{formatDate(t.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function renderLeads() {
    if (leadsLoading) return <Spinner />
    if (!leads || leads.length === 0) return <Empty msg="No sales leads for this customer" />
    return (
      <div className="divide-y divide-gray-50">
        {leads.map((l) => (
          <div key={l.id} className="flex items-center justify-between px-6 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-qm-black truncate">{l.title}</p>
              <p className="text-xs text-qm-gray mt-0.5">{formatDate(l.created_at)}</p>
            </div>
            {l.estimated_value != null && (
              <div className="ml-4 shrink-0 text-right">
                <p className="text-sm font-semibold text-qm-black">${formatCents(l.estimated_value)}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const contentByTab: Record<Tab, () => React.ReactNode> = {
    transactions: renderTransactions,
    payments: renderPayments,
    contacts: () => contactsSlot,
    jobs: renderJobs,
    quotes: renderQuotes,
    invoices: renderInvoices,
    tasks: renderTasks,
    leads: renderLeads,
  }

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Tab nav */}
      <div className="overflow-x-auto border-b border-gray-200">
        <nav className="flex min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-5 py-3.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'border-qm-lime text-qm-lime'
                  : 'border-transparent text-gray-500 hover:text-qm-black hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.count != null && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  activeTab === tab.key ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto max-h-[480px]">
        {contentByTab[activeTab]()}
      </div>
    </div>
  )
}
