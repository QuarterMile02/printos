'use client'

import { useState } from 'react'
import {
  upsertAccountingSettings,
  createSalesTax, updateSalesTax, deleteSalesTax, setDefaultSalesTax,
  createTermCode, updateTermCode, deleteTermCode, setDefaultTermCode,
  createPaymentMethod, updatePaymentMethod, deletePaymentMethod,
  createChartOfAccount, updateChartOfAccount, deleteChartOfAccount,
  updateAccountMapping,
  updateTransactionNumbers,
} from './actions'

// ─── Types ───────────────────────────────────────────────────────────────────

type AcctSettings = {
  accounting_software: string
  accounting_method: string
  program_fee_credit_card: number
  program_fee_debit_card: number
  program_fee_taxable: boolean
  program_fee_show_disclosure: boolean
}

type SalesTax = {
  id: string
  name: string
  agency: string | null
  description: string | null
  rate: number
  is_split: boolean
  tax_code: string | null
  is_default: boolean
  sort_order: number
}

type TermCode = {
  id: string
  name: string
  code_type: string
  days: number
  down_payment_percent: number
  is_default: boolean
  sort_order: number
}

type PaymentMethod = {
  id: string
  name: string
  type: string
  sort_order: number
}

type ChartOfAccount = {
  id: string
  name: string
  number: string | null
  type: string
  sort_order: number
}

type AccountMapping = {
  accounts_receivable_id: string | null
  cost_of_goods_id: string | null
  cost_of_material_id: string | null
  custom_item_cog_id: string | null
  custom_item_income_id: string | null
  finance_charges_id: string | null
  inhouse_sales_id: string | null
  misc_charges_id: string | null
  freight_charges_id: string | null
  outsourced_sales_id: string | null
  purchase_orders_id: string | null
  setup_charges_id: string | null
  shipping_charges_id: string | null
  tax_payable_id: string | null
  undeposited_funds_id: string | null
}

type TxNums = {
  next_quote_number: number
  next_sales_order_number: number
  next_invoice_number: number
  next_purchase_order_number: number
  next_payment_number: number
  next_refund_number: number
  next_credit_memo_number: number
}

export type Props = {
  orgId: string
  orgSlug: string
  initialAcctSettings: Partial<AcctSettings>
  initialSalesTaxes: SalesTax[]
  initialTermCodes: TermCode[]
  initialPaymentMethods: PaymentMethod[]
  initialChartOfAccounts: ChartOfAccount[]
  initialAccountMapping: Partial<AccountMapping>
  initialTxNums: Partial<TxNums>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACCT_SETTINGS_DEFAULTS: AcctSettings = {
  accounting_software: 'QuickBooks Desktop',
  accounting_method: 'Cash',
  program_fee_credit_card: 0,
  program_fee_debit_card: 0,
  program_fee_taxable: false,
  program_fee_show_disclosure: false,
}

const TX_NUMS_DEFAULTS: TxNums = {
  next_quote_number: 1,
  next_sales_order_number: 1,
  next_invoice_number: 1,
  next_purchase_order_number: 1,
  next_payment_number: 1,
  next_refund_number: 1,
  next_credit_memo_number: 1,
}

function SectionCard({ title, children, noPad }: { title: string; children: React.ReactNode; noPad?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
      </div>
      <div className={noPad ? '' : 'px-5 py-2'}>{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer group border-b border-gray-50 last:border-b-0">
      <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-1 ${on ? 'bg-qm-lime' : 'bg-gray-200'}`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </label>
  )
}

function SaveCancelBtns({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-1">
      <button type="button" onClick={onSave} className="rounded px-2 py-1 text-xs font-medium bg-qm-lime text-gray-900 hover:opacity-90">Save</button>
      <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">Cancel</button>
    </div>
  )
}

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      {label}
    </button>
  )
}

function TH({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 ${className}`}>{children}</th>
}

function TD({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm text-gray-700 ${className}`}>{children}</td>
}

function TInput({ value, onChange, placeholder = '', type = 'text', className = '' }: {
  value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime ${className}`}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountingClient({
  orgId, orgSlug,
  initialAcctSettings, initialSalesTaxes, initialTermCodes,
  initialPaymentMethods, initialChartOfAccounts,
  initialAccountMapping, initialTxNums,
}: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ── Accounting Settings ────────────────────────────────────────────────────
  const [acct, setAcct] = useState<AcctSettings>({ ...ACCT_SETTINGS_DEFAULTS, ...initialAcctSettings })

  async function saveAcct(patch: Partial<AcctSettings>) {
    setAcct((prev) => ({ ...prev, ...patch }))
    const res = await upsertAccountingSettings(orgId, orgSlug, patch)
    showToast(res.error ? `Error: ${res.error}` : 'Saved')
  }

  // ── Sales Taxes ────────────────────────────────────────────────────────────
  const [taxes, setTaxes] = useState<SalesTax[]>(initialSalesTaxes)
  const [editTaxId, setEditTaxId] = useState<string | null>(null)
  const [taxDraft, setTaxDraft] = useState<Partial<SalesTax>>({})
  const [addingTax, setAddingTax] = useState(false)
  const [newTax, setNewTax] = useState<Partial<SalesTax>>({ name: '', agency: '', description: '', rate: 0, is_split: false, tax_code: '', is_default: false })
  const [deletingTaxId, setDeletingTaxId] = useState<string | null>(null)

  async function saveTax(id: string) {
    const res = await updateSalesTax(id, orgId, orgSlug, taxDraft)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTaxes((prev) => prev.map((t) => t.id === id ? { ...t, ...taxDraft } : t))
    setEditTaxId(null)
    showToast('Saved')
  }

  async function addTax() {
    if (!newTax.name?.trim()) return
    const res = await createSalesTax(orgId, orgSlug, {
      name: newTax.name!, agency: newTax.agency ?? null, description: newTax.description ?? null,
      rate: newTax.rate ?? 0, is_split: newTax.is_split ?? false,
      tax_code: newTax.tax_code ?? null, is_default: false, sort_order: taxes.length + 1,
    })
    if (res.error || !res.data) { showToast(`Error: ${res.error ?? 'No data returned'}`); return }
    setTaxes((prev) => [...prev, res.data as unknown as SalesTax])
    setAddingTax(false)
    setNewTax({ name: '', agency: '', description: '', rate: 0, is_split: false, tax_code: '', is_default: false })
    showToast('Saved')
  }

  async function deleteTax(id: string) {
    const res = await deleteSalesTax(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTaxes((prev) => prev.filter((t) => t.id !== id))
    setDeletingTaxId(null)
    showToast('Deleted')
  }

  async function setTaxDefault(id: string) {
    const res = await setDefaultSalesTax(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTaxes((prev) => prev.map((t) => ({ ...t, is_default: t.id === id })))
  }

  // ── Term Codes ─────────────────────────────────────────────────────────────
  const [terms, setTerms] = useState<TermCode[]>(initialTermCodes)
  const [editTermId, setEditTermId] = useState<string | null>(null)
  const [termDraft, setTermDraft] = useState<Partial<TermCode>>({})
  const [addingTerm, setAddingTerm] = useState(false)
  const [newTerm, setNewTerm] = useState<Partial<TermCode>>({ name: '', code_type: 'Standard', days: 0, down_payment_percent: 0, is_default: false })
  const [deletingTermId, setDeletingTermId] = useState<string | null>(null)

  async function saveTerm(id: string) {
    const res = await updateTermCode(id, orgId, orgSlug, termDraft)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTerms((prev) => prev.map((t) => t.id === id ? { ...t, ...termDraft } : t))
    setEditTermId(null)
    showToast('Saved')
  }

  async function addTerm() {
    if (!newTerm.name?.trim()) return
    const res = await createTermCode(orgId, orgSlug, {
      name: newTerm.name!, code_type: newTerm.code_type ?? 'Standard',
      days: newTerm.days ?? 0, down_payment_percent: newTerm.down_payment_percent ?? 0,
      is_default: false, sort_order: terms.length + 1,
    })
    if (res.error || !res.data) { showToast(`Error: ${res.error ?? 'No data returned'}`); return }
    setTerms((prev) => [...prev, res.data as unknown as TermCode])
    setAddingTerm(false)
    setNewTerm({ name: '', code_type: 'Standard', days: 0, down_payment_percent: 0, is_default: false })
    showToast('Saved')
  }

  async function deleteTerm(id: string) {
    const res = await deleteTermCode(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTerms((prev) => prev.filter((t) => t.id !== id))
    setDeletingTermId(null)
    showToast('Deleted')
  }

  async function setTermDefault(id: string) {
    const res = await setDefaultTermCode(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTerms((prev) => prev.map((t) => ({ ...t, is_default: t.id === id })))
  }

  // ── Payment Methods ────────────────────────────────────────────────────────
  const [pms, setPms] = useState<PaymentMethod[]>(initialPaymentMethods)
  const [editPmId, setEditPmId] = useState<string | null>(null)
  const [pmDraft, setPmDraft] = useState<Partial<PaymentMethod>>({})
  const [addingPm, setAddingPm] = useState(false)
  const [newPm, setNewPm] = useState<Partial<PaymentMethod>>({ name: '', type: 'Other' })
  const [deletingPmId, setDeletingPmId] = useState<string | null>(null)

  async function savePm(id: string) {
    const res = await updatePaymentMethod(id, orgId, orgSlug, pmDraft)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setPms((prev) => prev.map((p) => p.id === id ? { ...p, ...pmDraft } : p))
    setEditPmId(null)
    showToast('Saved')
  }

  async function addPm() {
    if (!newPm.name?.trim()) return
    const res = await createPaymentMethod(orgId, orgSlug, { name: newPm.name!, type: newPm.type ?? 'Other', sort_order: pms.length + 1 })
    if (res.error || !res.data) { showToast(`Error: ${res.error ?? 'No data returned'}`); return }
    setPms((prev) => [...prev, res.data as unknown as PaymentMethod])
    setAddingPm(false)
    setNewPm({ name: '', type: 'Other' })
    showToast('Saved')
  }

  async function deletePm(id: string) {
    const res = await deletePaymentMethod(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setPms((prev) => prev.filter((p) => p.id !== id))
    setDeletingPmId(null)
    showToast('Deleted')
  }

  // ── Chart of Accounts ──────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<ChartOfAccount[]>(initialChartOfAccounts)
  const [editAcctId, setEditAcctId] = useState<string | null>(null)
  const [acctDraft, setAcctDraft] = useState<Partial<ChartOfAccount>>({})
  const [addingAcct, setAddingAcct] = useState(false)
  const [newAcct, setNewAcct] = useState<Partial<ChartOfAccount>>({ name: '', number: '', type: 'Income' })
  const [deletingAcctId, setDeletingAcctId] = useState<string | null>(null)

  async function saveAcctRow(id: string) {
    const res = await updateChartOfAccount(id, orgId, orgSlug, acctDraft)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, ...acctDraft } : a))
    setEditAcctId(null)
    showToast('Saved')
  }

  async function addAcctRow() {
    if (!newAcct.name?.trim()) return
    const res = await createChartOfAccount(orgId, orgSlug, {
      name: newAcct.name!, number: newAcct.number ?? null, type: newAcct.type ?? 'Income', sort_order: accounts.length + 1,
    })
    if (res.error || !res.data) { showToast(`Error: ${res.error ?? 'No data returned'}`); return }
    setAccounts((prev) => [...prev, res.data as unknown as ChartOfAccount])
    setAddingAcct(false)
    setNewAcct({ name: '', number: '', type: 'Income' })
    showToast('Saved')
  }

  async function deleteAcctRow(id: string) {
    const res = await deleteChartOfAccount(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setAccounts((prev) => prev.filter((a) => a.id !== id))
    setDeletingAcctId(null)
    showToast('Deleted')
  }

  // ── Account Mapping ────────────────────────────────────────────────────────
  const [mapping, setMapping] = useState<Partial<AccountMapping>>(initialAccountMapping)
  const [savedMapFields, setSavedMapFields] = useState<Set<string>>(new Set())

  async function saveMapping(field: string, value: string | null) {
    setMapping((prev) => ({ ...prev, [field]: value }))
    const res = await updateAccountMapping(orgId, orgSlug, { [field]: value || null })
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setSavedMapFields((prev) => new Set([...prev, field]))
    setTimeout(() => setSavedMapFields((prev) => { const n = new Set(prev); n.delete(field); return n }), 2000)
  }

  const MAPPING_ROWS: { label: string; field: keyof AccountMapping }[] = [
    { label: 'Accounts Receivable', field: 'accounts_receivable_id' },
    { label: 'Cost of Goods', field: 'cost_of_goods_id' },
    { label: 'Cost of Material', field: 'cost_of_material_id' },
    { label: 'Custom Item COG', field: 'custom_item_cog_id' },
    { label: 'Custom Item Income', field: 'custom_item_income_id' },
    { label: 'Finance Charges', field: 'finance_charges_id' },
    { label: 'In House Sales', field: 'inhouse_sales_id' },
    { label: 'Misc Charges', field: 'misc_charges_id' },
    { label: 'Freight Charges', field: 'freight_charges_id' },
    { label: 'Outsourced Sales', field: 'outsourced_sales_id' },
    { label: 'Purchase Orders', field: 'purchase_orders_id' },
    { label: 'Setup Charges', field: 'setup_charges_id' },
    { label: 'Shipping Charges', field: 'shipping_charges_id' },
    { label: 'Tax Payable', field: 'tax_payable_id' },
    { label: 'Undeposited Funds', field: 'undeposited_funds_id' },
  ]

  // ── Transaction Numbers ────────────────────────────────────────────────────
  const [txNums, setTxNums] = useState<TxNums>({ ...TX_NUMS_DEFAULTS, ...initialTxNums })
  const [savedTxFields, setSavedTxFields] = useState<Set<string>>(new Set())

  async function saveTxNum(field: keyof TxNums) {
    const res = await updateTransactionNumbers(orgId, orgSlug, { [field]: txNums[field] })
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setSavedTxFields((prev) => new Set([...prev, field]))
    setTimeout(() => setSavedTxFields((prev) => { const n = new Set(prev); n.delete(field); return n }), 2000)
  }

  const TX_ROWS: { label: string; field: keyof TxNums }[] = [
    { label: 'Quote', field: 'next_quote_number' },
    { label: 'Sales Order', field: 'next_sales_order_number' },
    { label: 'Invoice', field: 'next_invoice_number' },
    { label: 'Purchase Order', field: 'next_purchase_order_number' },
    { label: 'Payment', field: 'next_payment_number' },
    { label: 'Refund', field: 'next_refund_number' },
    { label: 'Credit Memo', field: 'next_credit_memo_number' },
  ]

  // ── Program Fee (part of accounting settings) ──────────────────────────────
  const [pfSaved, setPfSaved] = useState(false)

  async function saveProgramFee() {
    const res = await upsertAccountingSettings(orgId, orgSlug, {
      program_fee_credit_card: acct.program_fee_credit_card,
      program_fee_debit_card: acct.program_fee_debit_card,
      program_fee_taxable: acct.program_fee_taxable,
      program_fee_show_disclosure: acct.program_fee_show_disclosure,
    })
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setPfSaved(true)
    setTimeout(() => setPfSaved(false), 2000)
  }

  // ── Reusable type dropdowns ────────────────────────────────────────────────
  const COA_TYPES = ['Income', 'Cost of Goods Sold', 'Accounts Receivable', 'Other Current Asset', 'Expense']
  const PM_TYPES = ['Cash', 'Check', 'Credit Card', 'Other']

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {/* ── 1. ACCOUNTING SOFTWARE ───────────────────────────────────────── */}
      <SectionCard title="Accounting Software">
        {/* Locked QB Desktop display */}
        <div className="flex items-center gap-3 py-3 border-b border-gray-50">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white font-bold text-sm shrink-0">QB</div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">QuickBooks Desktop</p>
            <p className="text-xs text-gray-400">IIF export format — import via File → Utilities → Import → IIF Files in QB Desktop</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            Active
          </div>
        </div>

        {/* Accounting Method */}
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-gray-700">Accounting Method</span>
          <select
            value={acct.accounting_method}
            onChange={(e) => saveAcct({ accounting_method: e.target.value })}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option>Cash</option>
            <option>Accrual</option>
          </select>
        </div>
      </SectionCard>

      {/* ── 2. SALES TAXES ───────────────────────────────────────────────── */}
      <SectionCard title="Sales Taxes" noPad>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100">
              <tr>
                <TH>Name</TH>
                <TH>Agency</TH>
                <TH>Description</TH>
                <TH className="text-right">Rate %</TH>
                <TH className="text-center">Split</TH>
                <TH>Tax Code</TH>
                <TH className="text-center">Default</TH>
                <TH className="w-24">&nbsp;</TH>
              </tr>
            </thead>
            <tbody>
              {taxes.map((tax) =>
                editTaxId === tax.id ? (
                  <tr key={tax.id} className="bg-blue-50/40">
                    <TD><TInput value={taxDraft.name ?? tax.name} onChange={(v) => setTaxDraft((d) => ({ ...d, name: v }))} /></TD>
                    <TD><TInput value={taxDraft.agency ?? tax.agency ?? ''} onChange={(v) => setTaxDraft((d) => ({ ...d, agency: v }))} /></TD>
                    <TD><TInput value={taxDraft.description ?? tax.description ?? ''} onChange={(v) => setTaxDraft((d) => ({ ...d, description: v }))} /></TD>
                    <TD><TInput type="number" value={taxDraft.rate ?? tax.rate} onChange={(v) => setTaxDraft((d) => ({ ...d, rate: parseFloat(v) || 0 }))} className="w-20 text-right" /></TD>
                    <TD className="text-center">
                      <input type="checkbox" checked={taxDraft.is_split ?? tax.is_split} onChange={(e) => setTaxDraft((d) => ({ ...d, is_split: e.target.checked }))} className="h-4 w-4 accent-qm-lime" />
                    </TD>
                    <TD><TInput value={taxDraft.tax_code ?? tax.tax_code ?? ''} onChange={(v) => setTaxDraft((d) => ({ ...d, tax_code: v }))} /></TD>
                    <TD className="text-center"><span className="text-xs text-gray-400">—</span></TD>
                    <TD><SaveCancelBtns onSave={() => saveTax(tax.id)} onCancel={() => setEditTaxId(null)} /></TD>
                  </tr>
                ) : (
                  <tr key={tax.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <TD className="font-medium">{tax.name}</TD>
                    <TD className="text-gray-500">{tax.agency ?? '—'}</TD>
                    <TD className="text-gray-500 text-xs">{tax.description ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{Number(tax.rate).toFixed(2)}</TD>
                    <TD className="text-center">{tax.is_split ? '✓' : ''}</TD>
                    <TD className="text-gray-500">{tax.tax_code ?? '—'}</TD>
                    <TD className="text-center">
                      <input type="radio" name="tax_default" checked={tax.is_default} onChange={() => setTaxDefault(tax.id)} className="accent-qm-lime cursor-pointer" />
                    </TD>
                    <TD>
                      {deletingTaxId === tax.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button type="button" onClick={() => deleteTax(tax.id)} className="text-xs font-medium text-red-600 hover:underline">Yes</button>
                          <button type="button" onClick={() => setDeletingTaxId(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => { setEditTaxId(tax.id); setTaxDraft({}) }} title="Edit" className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
                          </button>
                          <button type="button" onClick={() => setDeletingTaxId(tax.id)} title="Delete" className="rounded p-1 text-red-300 hover:text-red-600 hover:bg-red-50">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                    </TD>
                  </tr>
                ),
              )}
              {addingTax && (
                <tr className="border-t border-blue-100 bg-blue-50/40">
                  <TD><TInput value={newTax.name ?? ''} onChange={(v) => setNewTax((d) => ({ ...d, name: v }))} placeholder="Name" /></TD>
                  <TD><TInput value={newTax.agency ?? ''} onChange={(v) => setNewTax((d) => ({ ...d, agency: v }))} placeholder="Agency" /></TD>
                  <TD><TInput value={newTax.description ?? ''} onChange={(v) => setNewTax((d) => ({ ...d, description: v }))} placeholder="Description" /></TD>
                  <TD><TInput type="number" value={newTax.rate ?? 0} onChange={(v) => setNewTax((d) => ({ ...d, rate: parseFloat(v) || 0 }))} className="w-20 text-right" /></TD>
                  <TD className="text-center"><input type="checkbox" checked={newTax.is_split ?? false} onChange={(e) => setNewTax((d) => ({ ...d, is_split: e.target.checked }))} className="h-4 w-4 accent-qm-lime" /></TD>
                  <TD><TInput value={newTax.tax_code ?? ''} onChange={(v) => setNewTax((d) => ({ ...d, tax_code: v }))} placeholder="Code" /></TD>
                  <TD />
                  <TD><SaveCancelBtns onSave={addTax} onCancel={() => setAddingTax(false)} /></TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          {!addingTax && <AddBtn label="Add New Sales Tax" onClick={() => setAddingTax(true)} />}
        </div>
      </SectionCard>

      {/* ── 3. TERM CODES ────────────────────────────────────────────────── */}
      <SectionCard title="Term Codes" noPad>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100">
              <tr>
                <TH>Name</TH>
                <TH>Code Type</TH>
                <TH className="text-right">Days</TH>
                <TH className="text-right">Down Pmt %</TH>
                <TH className="text-center">Default</TH>
                <TH className="w-24">&nbsp;</TH>
              </tr>
            </thead>
            <tbody>
              {terms.map((term) =>
                editTermId === term.id ? (
                  <tr key={term.id} className="bg-blue-50/40">
                    <TD><TInput value={termDraft.name ?? term.name} onChange={(v) => setTermDraft((d) => ({ ...d, name: v }))} /></TD>
                    <TD>
                      <select value={termDraft.code_type ?? term.code_type} onChange={(e) => setTermDraft((d) => ({ ...d, code_type: e.target.value }))}
                        className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                        <option>Standard</option>
                      </select>
                    </TD>
                    <TD><TInput type="number" value={termDraft.days ?? term.days} onChange={(v) => setTermDraft((d) => ({ ...d, days: parseInt(v) || 0 }))} className="w-16 text-right" /></TD>
                    <TD><TInput type="number" value={termDraft.down_payment_percent ?? term.down_payment_percent} onChange={(v) => setTermDraft((d) => ({ ...d, down_payment_percent: parseFloat(v) || 0 }))} className="w-16 text-right" /></TD>
                    <TD className="text-center"><span className="text-xs text-gray-400">—</span></TD>
                    <TD><SaveCancelBtns onSave={() => saveTerm(term.id)} onCancel={() => setEditTermId(null)} /></TD>
                  </tr>
                ) : (
                  <tr key={term.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <TD className="font-medium">{term.name}</TD>
                    <TD className="text-gray-500">{term.code_type}</TD>
                    <TD className="text-right tabular-nums">{term.days}</TD>
                    <TD className="text-right tabular-nums">{Number(term.down_payment_percent).toFixed(0)}</TD>
                    <TD className="text-center">
                      <input type="radio" name="term_default" checked={term.is_default} onChange={() => setTermDefault(term.id)} className="accent-qm-lime cursor-pointer" />
                    </TD>
                    <TD>
                      {deletingTermId === term.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button type="button" onClick={() => deleteTerm(term.id)} className="text-xs font-medium text-red-600 hover:underline">Yes</button>
                          <button type="button" onClick={() => setDeletingTermId(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => { setEditTermId(term.id); setTermDraft({}) }} title="Edit" className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
                          </button>
                          <button type="button" onClick={() => setDeletingTermId(term.id)} title="Delete" className="rounded p-1 text-red-300 hover:text-red-600 hover:bg-red-50">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                    </TD>
                  </tr>
                ),
              )}
              {addingTerm && (
                <tr className="border-t border-blue-100 bg-blue-50/40">
                  <TD><TInput value={newTerm.name ?? ''} onChange={(v) => setNewTerm((d) => ({ ...d, name: v }))} placeholder="Name" /></TD>
                  <TD>
                    <select value={newTerm.code_type ?? 'Standard'} onChange={(e) => setNewTerm((d) => ({ ...d, code_type: e.target.value }))}
                      className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                      <option>Standard</option>
                    </select>
                  </TD>
                  <TD><TInput type="number" value={newTerm.days ?? 0} onChange={(v) => setNewTerm((d) => ({ ...d, days: parseInt(v) || 0 }))} className="w-16 text-right" /></TD>
                  <TD><TInput type="number" value={newTerm.down_payment_percent ?? 0} onChange={(v) => setNewTerm((d) => ({ ...d, down_payment_percent: parseFloat(v) || 0 }))} className="w-16 text-right" /></TD>
                  <TD />
                  <TD><SaveCancelBtns onSave={addTerm} onCancel={() => setAddingTerm(false)} /></TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          {!addingTerm && <AddBtn label="Add New Term Code" onClick={() => setAddingTerm(true)} />}
        </div>
      </SectionCard>

      {/* ── 4. PAYMENT METHODS ───────────────────────────────────────────── */}
      <SectionCard title="Payment Methods" noPad>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100">
              <tr>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH className="w-24">&nbsp;</TH>
              </tr>
            </thead>
            <tbody>
              {pms.map((pm) =>
                editPmId === pm.id ? (
                  <tr key={pm.id} className="bg-blue-50/40">
                    <TD><TInput value={pmDraft.name ?? pm.name} onChange={(v) => setPmDraft((d) => ({ ...d, name: v }))} /></TD>
                    <TD>
                      <select value={pmDraft.type ?? pm.type} onChange={(e) => setPmDraft((d) => ({ ...d, type: e.target.value }))}
                        className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                        {PM_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </TD>
                    <TD><SaveCancelBtns onSave={() => savePm(pm.id)} onCancel={() => setEditPmId(null)} /></TD>
                  </tr>
                ) : (
                  <tr key={pm.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <TD className="font-medium">{pm.name}</TD>
                    <TD className="text-gray-500">{pm.type}</TD>
                    <TD>
                      {deletingPmId === pm.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button type="button" onClick={() => deletePm(pm.id)} className="text-xs font-medium text-red-600 hover:underline">Yes</button>
                          <button type="button" onClick={() => setDeletingPmId(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => { setEditPmId(pm.id); setPmDraft({}) }} title="Edit" className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
                          </button>
                          <button type="button" onClick={() => setDeletingPmId(pm.id)} title="Delete" className="rounded p-1 text-red-300 hover:text-red-600 hover:bg-red-50">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                    </TD>
                  </tr>
                ),
              )}
              {addingPm && (
                <tr className="border-t border-blue-100 bg-blue-50/40">
                  <TD><TInput value={newPm.name ?? ''} onChange={(v) => setNewPm((d) => ({ ...d, name: v }))} placeholder="Name" /></TD>
                  <TD>
                    <select value={newPm.type ?? 'Other'} onChange={(e) => setNewPm((d) => ({ ...d, type: e.target.value }))}
                      className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                      {PM_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </TD>
                  <TD><SaveCancelBtns onSave={addPm} onCancel={() => setAddingPm(false)} /></TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          {!addingPm && <AddBtn label="Add New Payment Method" onClick={() => setAddingPm(true)} />}
        </div>
      </SectionCard>

      {/* ── 5. CHART OF ACCOUNTS ─────────────────────────────────────────── */}
      <SectionCard title="Chart of Accounts" noPad>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-100">
              <tr>
                <TH>Name</TH>
                <TH>Number</TH>
                <TH>Type</TH>
                <TH className="w-24">&nbsp;</TH>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) =>
                editAcctId === a.id ? (
                  <tr key={a.id} className="bg-blue-50/40">
                    <TD><TInput value={acctDraft.name ?? a.name} onChange={(v) => setAcctDraft((d) => ({ ...d, name: v }))} /></TD>
                    <TD><TInput value={acctDraft.number ?? a.number ?? ''} onChange={(v) => setAcctDraft((d) => ({ ...d, number: v }))} className="w-24" /></TD>
                    <TD>
                      <select value={acctDraft.type ?? a.type} onChange={(e) => setAcctDraft((d) => ({ ...d, type: e.target.value }))}
                        className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                        {COA_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </TD>
                    <TD><SaveCancelBtns onSave={() => saveAcctRow(a.id)} onCancel={() => setEditAcctId(null)} /></TD>
                  </tr>
                ) : (
                  <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <TD className="font-medium">{a.name}</TD>
                    <TD className="text-gray-500 tabular-nums">{a.number ?? '—'}</TD>
                    <TD className="text-gray-500">{a.type}</TD>
                    <TD>
                      {deletingAcctId === a.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-600">Delete?</span>
                          <button type="button" onClick={() => deleteAcctRow(a.id)} className="text-xs font-medium text-red-600 hover:underline">Yes</button>
                          <button type="button" onClick={() => setDeletingAcctId(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button type="button" onClick={() => { setEditAcctId(a.id); setAcctDraft({}) }} title="Edit" className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
                          </button>
                          <button type="button" onClick={() => setDeletingAcctId(a.id)} title="Delete" className="rounded p-1 text-red-300 hover:text-red-600 hover:bg-red-50">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      )}
                    </TD>
                  </tr>
                ),
              )}
              {addingAcct && (
                <tr className="border-t border-blue-100 bg-blue-50/40">
                  <TD><TInput value={newAcct.name ?? ''} onChange={(v) => setNewAcct((d) => ({ ...d, name: v }))} placeholder="Name" /></TD>
                  <TD><TInput value={newAcct.number ?? ''} onChange={(v) => setNewAcct((d) => ({ ...d, number: v }))} placeholder="Number" className="w-24" /></TD>
                  <TD>
                    <select value={newAcct.type ?? 'Income'} onChange={(e) => setNewAcct((d) => ({ ...d, type: e.target.value }))}
                      className="rounded border border-gray-200 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none">
                      {COA_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </TD>
                  <TD><SaveCancelBtns onSave={addAcctRow} onCancel={() => setAddingAcct(false)} /></TD>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          {!addingAcct && <AddBtn label="Add New Chart of Account" onClick={() => setAddingAcct(true)} />}
        </div>
      </SectionCard>

      {/* ── 6. ACCOUNT MAPPING ───────────────────────────────────────────── */}
      <SectionCard title="Chart of Account Mapping">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 py-1">
          {MAPPING_ROWS.map(({ label, field }) => {
            const currentVal = (mapping[field] as string | null | undefined) ?? ''
            const justSaved = savedMapFields.has(field)
            return (
              <div key={field} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <span className="w-40 shrink-0 text-sm text-gray-700">{label}</span>
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <select
                    value={currentVal}
                    onChange={(e) => saveMapping(field, e.target.value || null)}
                    className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                  >
                    <option value="">— none —</option>
                    {accounts
                      .slice()
                      .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? ''))
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.number ? `${a.number} - ${a.name}` : a.name}
                        </option>
                      ))}
                  </select>
                  {justSaved && <span className="text-xs font-medium text-green-600 whitespace-nowrap">Saved ✓</span>}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* ── 7. TRANSACTION NUMBERS ───────────────────────────────────────── */}
      <SectionCard title="Transaction Numbers">
        <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Set these higher than your last QB Desktop transaction numbers at cutover time.
        </p>
        <table className="w-full">
          <tbody>
            {TX_ROWS.map(({ label, field }) => {
              const justSaved = savedTxFields.has(field)
              return (
                <tr key={field} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-sm text-gray-700 w-44">{label}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={1}
                      value={txNums[field]}
                      onChange={(e) => setTxNums((prev) => ({ ...prev, [field]: parseInt(e.target.value) || 1 }))}
                      className="w-28 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                    />
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => saveTxNum(field)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                        Save
                      </button>
                      {justSaved && <span className="text-xs font-medium text-green-600">Saved ✓</span>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </SectionCard>

      {/* ── 8. PROGRAM FEE ───────────────────────────────────────────────── */}
      <SectionCard title="Program Fee">
        <div className="flex items-center justify-between py-2 border-b border-gray-50">
          <span className="text-sm text-gray-700">Credit Card %</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={acct.program_fee_credit_card}
            onChange={(e) => setAcct((prev) => ({ ...prev, program_fee_credit_card: parseFloat(e.target.value) || 0 }))}
            className="w-24 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div className="flex items-center justify-between py-2 border-b border-gray-50">
          <span className="text-sm text-gray-700">Debit Card %</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={acct.program_fee_debit_card}
            onChange={(e) => setAcct((prev) => ({ ...prev, program_fee_debit_card: parseFloat(e.target.value) || 0 }))}
            className="w-24 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <Toggle
          on={acct.program_fee_taxable}
          onChange={(v) => setAcct((prev) => ({ ...prev, program_fee_taxable: v }))}
          label="Program Fee Charges Taxable"
        />
        <Toggle
          on={acct.program_fee_show_disclosure}
          onChange={(v) => setAcct((prev) => ({ ...prev, program_fee_show_disclosure: v }))}
          label="Show Fee Disclosure in PDFs"
        />
        <div className="flex items-center gap-3 pt-3">
          <button type="button" onClick={saveProgramFee}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors">
            Save
          </button>
          {pfSaved && <span className="text-sm font-medium text-green-600">Saved ✓</span>}
        </div>
      </SectionCard>
    </div>
  )
}
