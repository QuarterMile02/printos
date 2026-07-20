'use client'

import { useState, useTransition, useCallback } from 'react'
import { updateTransactionSettings, TransactionSettingsPatch } from './actions'

type Settings = {
  show_parent_description_only: boolean
  check_line_item_minimum_before_discount: boolean
  allow_discount_codes: boolean
  allow_line_item_taxable_override: boolean
  default_include_payment_link: boolean
  down_payment_type: string
  down_payment_amount: number
  default_next_contact_date_days: number
  hide_ordered_quotes: boolean
  hide_invoiced_quotes: boolean
  hide_lost_quotes: boolean
  online_quote_review_by_customer: boolean
  allow_change_financial_info_after_convert: boolean
  default_quote_expiration_days: number
  sync_zero_invoices: boolean
  allow_editing_of_invoice: boolean
  taxes_on_purchase_orders: boolean
  purchase_orders_combine_items: boolean
  default_po_line_item_type: string
  default_inhouse_commission_on: string
  default_outsourced_commission_on: string
  sales_commission_by: string
  setup_charge_default: number
  setup_charge_type: string
  setup_charge_taxable: boolean
  shipping_charge_default: number
  shipping_charge_type: string
  shipping_charge_taxable: boolean
  finance_charge_default: number
  finance_charge_type: string
  finance_charge_taxable: boolean
  misc_charge_default: number
  misc_charge_type: string
  misc_charge_taxable: boolean
  misc_charge_label: string
  copy_transaction_title_to_job: boolean
  keep_job_in_sync_with_line_item: boolean
  allow_jobs_for_quotes: boolean
  allow_jobs_for_invoices: boolean
  allow_jobs_without_downpayment: boolean
  show_customer_pending_balance: boolean
}

const DEFAULTS: Settings = {
  show_parent_description_only: false,
  check_line_item_minimum_before_discount: false,
  allow_discount_codes: false,
  allow_line_item_taxable_override: true,
  default_include_payment_link: false,
  down_payment_type: 'percent',
  down_payment_amount: 0,
  default_next_contact_date_days: 7,
  hide_ordered_quotes: false,
  hide_invoiced_quotes: false,
  hide_lost_quotes: false,
  online_quote_review_by_customer: true,
  allow_change_financial_info_after_convert: false,
  default_quote_expiration_days: 30,
  sync_zero_invoices: false,
  allow_editing_of_invoice: true,
  taxes_on_purchase_orders: false,
  purchase_orders_combine_items: false,
  default_po_line_item_type: 'Material',
  default_inhouse_commission_on: 'Price',
  default_outsourced_commission_on: 'Price',
  sales_commission_by: 'Closed Invoices',
  setup_charge_default: 0,
  setup_charge_type: 'dollar',
  setup_charge_taxable: false,
  shipping_charge_default: 0,
  shipping_charge_type: 'dollar',
  shipping_charge_taxable: false,
  finance_charge_default: 0,
  finance_charge_type: 'dollar',
  finance_charge_taxable: false,
  misc_charge_default: 0,
  misc_charge_type: 'dollar',
  misc_charge_taxable: false,
  misc_charge_label: 'Misc',
  copy_transaction_title_to_job: true,
  keep_job_in_sync_with_line_item: true,
  allow_jobs_for_quotes: false,
  allow_jobs_for_invoices: false,
  allow_jobs_without_downpayment: true,
  show_customer_pending_balance: true,
}

type Props = {
  orgId: string
  orgSlug: string
  initialSettings: Partial<Settings>
}

export default function TransactionsClient({ orgId, orgSlug, initialSettings }: Props) {
  const [s, setS] = useState<Settings>({ ...DEFAULTS, ...initialSettings })
  const [toast, setToast] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const save = useCallback(
    (patch: TransactionSettingsPatch) => {
      startTransition(async () => {
        const result = await updateTransactionSettings(orgId, orgSlug, patch)
        if (result.error) {
          setToast(`Error: ${result.error}`)
        } else {
          setToast('Saved')
        }
        setTimeout(() => setToast(null), 2000)
      })
    },
    [orgId, orgSlug],
  )

  function toggle(field: keyof Settings) {
    const next = !s[field] as boolean
    setS((prev) => ({ ...prev, [field]: next }))
    save({ [field]: next })
  }

  function setField<K extends keyof Settings>(field: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [field]: value }))
  }

  function commitField<K extends keyof Settings>(field: K) {
    save({ [field]: s[field] } as TransactionSettingsPatch)
  }

  function Toggle({ field, label }: { field: keyof Settings; label: string }) {
    const on = s[field] as boolean
    return (
      <label className="flex items-center justify-between gap-4 py-2.5 border-b border-gray-50 last:border-b-0 cursor-pointer group">
        <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => toggle(field)}
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-1 ${
            on ? 'bg-qm-lime' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
              on ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </label>
    )
  }

  function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
        </div>
        <div className="px-5 py-1">{children}</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
            toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          {toast}
        </div>
      )}

      {/* 1. GENERAL */}
      <SectionCard title="General">
        <Toggle field="show_parent_description_only" label="Show parent description only" />
        <Toggle field="check_line_item_minimum_before_discount" label="Check line item minimum before discount" />
        <Toggle field="allow_discount_codes" label="Allow discount codes" />
        <Toggle field="allow_line_item_taxable_override" label="Allow line item taxable override" />
        <Toggle field="default_include_payment_link" label="Default include payment link in emails" />

        {/* Down payment */}
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-700">Down payment</span>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              <button
                type="button"
                onClick={() => { setField('down_payment_type', 'dollar'); save({ down_payment_type: 'dollar' }) }}
                className={`px-2.5 py-1.5 transition-colors ${s.down_payment_type === 'dollar' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                $
              </button>
              <button
                type="button"
                onClick={() => { setField('down_payment_type', 'percent'); save({ down_payment_type: 'percent' }) }}
                className={`px-2.5 py-1.5 transition-colors border-l border-gray-200 ${s.down_payment_type === 'percent' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                %
              </button>
            </div>
            <input
              type="number"
              min={0}
              step={s.down_payment_type === 'percent' ? 1 : 0.01}
              value={s.down_payment_amount}
              onChange={(e) => setField('down_payment_amount', parseFloat(e.target.value) || 0)}
              onBlur={() => commitField('down_payment_amount')}
              className="w-20 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
        </div>

        {/* Default next contact date */}
        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-sm text-gray-700">Default next contact date after</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={s.default_next_contact_date_days}
              onChange={(e) => setField('default_next_contact_date_days', parseInt(e.target.value) || 0)}
              onBlur={() => commitField('default_next_contact_date_days')}
              className="w-16 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
            <span className="text-sm text-gray-500">Days</span>
          </div>
        </div>
      </SectionCard>

      {/* 2. QUOTES & SALES ORDERS */}
      <SectionCard title="Quotes & Sales Orders">
        <Toggle field="hide_ordered_quotes" label="Hide ordered quotes" />
        <Toggle field="hide_invoiced_quotes" label="Hide invoiced quotes & sales orders" />
        <Toggle field="hide_lost_quotes" label="Hide lost quotes" />
      </SectionCard>

      {/* 3. QUOTES */}
      <SectionCard title="Quotes">
        <Toggle field="online_quote_review_by_customer" label="Online quote review by customer" />
        <Toggle field="allow_change_financial_info_after_convert" label="Allow change financial info after quote is converted" />

        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-sm text-gray-700">Default quote expiration after</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={s.default_quote_expiration_days}
              onChange={(e) => setField('default_quote_expiration_days', parseInt(e.target.value) || 0)}
              onBlur={() => commitField('default_quote_expiration_days')}
              className="w-16 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
            <span className="text-sm text-gray-500">Days</span>
          </div>
        </div>
      </SectionCard>

      {/* 4. INVOICES */}
      <SectionCard title="Invoices">
        <Toggle field="sync_zero_invoices" label="Sync zero invoices" />
        <Toggle field="allow_editing_of_invoice" label="Allow editing of invoice" />
      </SectionCard>

      {/* 5. PURCHASE ORDERS */}
      <SectionCard title="Purchase Orders">
        <Toggle field="taxes_on_purchase_orders" label="Taxes charged on purchase orders" />
        <Toggle field="purchase_orders_combine_items" label="Purchase orders combine items" />

        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-sm text-gray-700">Default line item type</span>
          <select
            value={s.default_po_line_item_type}
            onChange={(e) => { setField('default_po_line_item_type', e.target.value); save({ default_po_line_item_type: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option>Material</option>
            <option>Labor</option>
            <option>Other</option>
          </select>
        </div>
      </SectionCard>

      {/* 6. SALES COMMISSIONS */}
      <SectionCard title="Sales Commissions">
        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-700">Default in-house commission on</span>
          <select
            value={s.default_inhouse_commission_on}
            onChange={(e) => { setField('default_inhouse_commission_on', e.target.value); save({ default_inhouse_commission_on: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option>Price</option>
            <option>Cost</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-700">Default outsourced commission on</span>
          <select
            value={s.default_outsourced_commission_on}
            onChange={(e) => { setField('default_outsourced_commission_on', e.target.value); save({ default_outsourced_commission_on: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option>Price</option>
            <option>Cost</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-sm text-gray-700">Sales commission by</span>
          <select
            value={s.sales_commission_by}
            onChange={(e) => { setField('sales_commission_by', e.target.value); save({ sales_commission_by: e.target.value }) }}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option>Closed Invoices</option>
            <option>All Invoices</option>
          </select>
        </div>
      </SectionCard>

      {/* 7. CHARGES */}
      <SectionCard title="Charges">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
          <span>Charge</span>
          <span className="w-24 text-center">Default</span>
          <span className="w-16 text-center">Type</span>
          <span className="w-16 text-center">Taxable</span>
        </div>

        {(
          [
            { label: 'Setup', prefix: 'setup' },
            { label: 'Shipping', prefix: 'shipping' },
            { label: 'Finance', prefix: 'finance' },
            { label: 'Misc', prefix: 'misc' },
          ] as const
        ).map(({ label, prefix }) => {
          const defaultField = `${prefix}_charge_default` as keyof Settings
          const typeField = `${prefix}_charge_type` as keyof Settings
          const taxableField = `${prefix}_charge_taxable` as keyof Settings

          return (
            <div key={prefix} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2.5 border-b border-gray-50 last:border-b-0">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-gray-700">{label}</span>
                {prefix === 'misc' && (
                  <input
                    type="text"
                    placeholder="Custom label"
                    value={s.misc_charge_label}
                    onChange={(e) => setField('misc_charge_label', e.target.value)}
                    onBlur={() => commitField('misc_charge_label')}
                    className="mt-0.5 w-32 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                  />
                )}
              </div>

              <div className="w-24">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={s[defaultField] as number}
                  onChange={(e) => setField(defaultField, parseFloat(e.target.value) || 0)}
                  onBlur={() => commitField(defaultField)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-right focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              <div className="w-16 flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                <button
                  type="button"
                  onClick={() => { setField(typeField, 'dollar'); save({ [typeField]: 'dollar' } as TransactionSettingsPatch) }}
                  className={`flex-1 py-1.5 transition-colors ${(s[typeField] as string) === 'dollar' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  $
                </button>
                <button
                  type="button"
                  onClick={() => { setField(typeField, 'percent'); save({ [typeField]: 'percent' } as TransactionSettingsPatch) }}
                  className={`flex-1 py-1.5 transition-colors border-l border-gray-200 ${(s[typeField] as string) === 'percent' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  %
                </button>
              </div>

              <div className="w-16 flex justify-center">
                <input
                  type="checkbox"
                  checked={s[taxableField] as boolean}
                  onChange={(e) => { setField(taxableField, e.target.checked); save({ [taxableField]: e.target.checked } as TransactionSettingsPatch) }}
                  className="h-4 w-4 accent-qm-lime cursor-pointer"
                />
              </div>
            </div>
          )
        })}
      </SectionCard>

      {/* 8. JOBS */}
      <SectionCard title="Jobs">
        <Toggle field="copy_transaction_title_to_job" label="Copy transaction title to job name" />
        <Toggle field="keep_job_in_sync_with_line_item" label="Keep job in sync with line item" />
        <Toggle field="allow_jobs_for_quotes" label="Allow jobs to be created for quotes" />
        <Toggle field="allow_jobs_for_invoices" label="Allow jobs to be created for invoices" />
        <Toggle field="allow_jobs_without_downpayment" label="Allow jobs to be created without downpayment" />
      </SectionCard>

      {/* 9. CUSTOMERS */}
      <SectionCard title="Customers">
        <Toggle field="show_customer_pending_balance" label="Show customer pending balance and credit info" />
      </SectionCard>
    </div>
  )
}
