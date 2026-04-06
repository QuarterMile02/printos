'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Product, ProductCategory, WorkflowTemplate, ProductStatus } from '@/types/product-builder'
import { createProduct, updateProduct, type ProductFormData } from './actions'

type Props = {
  orgId: string
  orgSlug: string
  product: Product | null // null = new
  categories: ProductCategory[]
  workflows: WorkflowTemplate[]
}

type TabKey = 'basic' | 'advanced' | 'pricing' | 'custom-fields'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: 'Basic Settings' },
  { key: 'advanced', label: 'Advanced Settings' },
  { key: 'pricing', label: 'Configure Pricing' },
  { key: 'custom-fields', label: 'Custom Fields' },
]

const STATUS_OPTIONS: { value: ProductStatus; label: string; style: string }[] = [
  { value: 'draft',     label: 'Draft',     style: 'bg-qm-gray-light text-qm-gray border-qm-gray' },
  { value: 'published', label: 'Published', style: 'bg-qm-lime-light text-qm-lime-dark border-qm-lime' },
  { value: 'disabled',  label: 'Disabled',  style: 'bg-red-50 text-red-700 border-red-300' },
  { value: 'archived',  label: 'Archived',  style: 'bg-qm-black/5 text-qm-gray border-gray-300' },
]

const COMPLEXITY_LABELS: Record<number, string> = {
  1: 'Simple',
  2: 'Easy',
  3: 'Standard',
  4: 'Complex',
  5: 'Expert',
}

function emptyForm(): ProductFormData {
  return {
    name: '',
    description: null,
    product_type: null,
    category_id: null,
    secondary_category: null,
    workflow_template_id: null,
    complexity_value: 3,
    image_url: null,
    status: 'draft',
  }
}

function toFormData(p: Product): ProductFormData {
  return {
    name: p.name,
    description: p.description,
    product_type: p.product_type,
    category_id: p.category_id,
    secondary_category: p.secondary_category,
    workflow_template_id: p.workflow_template_id,
    complexity_value: p.complexity_value ?? 3,
    image_url: p.image_url,
    status: p.status ?? 'draft',
  }
}

export default function ProductForm({ orgId, orgSlug, product, categories, workflows }: Props) {
  const router = useRouter()
  const isNew = product === null
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [form, setForm] = useState<ProductFormData>(product ? toFormData(product) : emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createProduct(orgId, orgSlug, form)
        if (result.error) setFormError(result.error)
        else if (result.id) {
          router.push(`/dashboard/${orgSlug}/products/${result.id}`)
        }
      } else if (product) {
        const result = await updateProduct(product.id, orgId, orgSlug, form)
        if (result.error) setFormError(result.error)
        else { showToast('Product saved'); router.refresh() }
      }
    })
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <a href={`/dashboard/${orgSlug}/products`} className="hover:text-gray-700">Products</a>
          <span>/</span>
          <span className="text-gray-700">{isNew ? 'New Product' : product?.name || 'Product'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <a href={`/dashboard/${orgSlug}/products`} className="inline-flex items-center gap-1.5 text-sm font-medium text-qm-gray hover:text-qm-black mb-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back to Products
            </a>
            <h1 className="text-2xl font-extrabold text-qm-black">
              {isNew ? 'New Product' : (form.name || 'Untitled Product')}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/dashboard/${orgSlug}/products`)}
              disabled={isPending}
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : isNew ? 'Create Product' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {formError && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
      )}

      {/* Tab strip */}
      <div className="mb-6 border-b border-gray-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === t.key
                ? 'border-qm-lime text-qm-lime'
                : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        {activeTab === 'basic' && (
          <div className="space-y-5 max-w-3xl">
            <Field label="Product Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                placeholder="e.g. Banner 13oz"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                rows={4}
                className={inputClass}
                placeholder="Detailed product description visible to staff and optionally customers"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Type / Unit of Business">
                <input
                  type="text"
                  value={form.product_type ?? ''}
                  onChange={(e) => setForm({ ...form, product_type: e.target.value || null })}
                  className={inputClass}
                  placeholder="e.g. Large Format Print"
                />
              </Field>
              <Field label="Workflow Template">
                <select
                  value={form.workflow_template_id ?? ''}
                  onChange={(e) => setForm({ ...form, workflow_template_id: e.target.value || null })}
                  className={inputClass}
                >
                  <option value="">— None —</option>
                  {workflows.filter((w) => w.active !== false).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Category">
                <select
                  value={form.category_id ?? ''}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                  className={inputClass}
                >
                  <option value="">— None —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Secondary Category">
                <input
                  type="text"
                  value={form.secondary_category ?? ''}
                  onChange={(e) => setForm({ ...form, secondary_category: e.target.value || null })}
                  className={inputClass}
                  placeholder="Optional sub-category"
                />
              </Field>
            </div>

            <Field label="Product Image URL">
              <input
                type="url"
                value={form.image_url ?? ''}
                onChange={(e) => setForm({ ...form, image_url: e.target.value || null })}
                className={inputClass}
                placeholder="https://..."
              />
              {form.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.image_url} alt="Preview" className="mt-2 h-24 w-24 rounded-md object-cover border border-gray-200" />
              )}
            </Field>

            {/* Complexity slider */}
            <Field label={`Complexity: ${form.complexity_value ?? 3} — ${COMPLEXITY_LABELS[form.complexity_value ?? 3]}`}>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={form.complexity_value ?? 3}
                onChange={(e) => setForm({ ...form, complexity_value: parseInt(e.target.value) })}
                className="w-full accent-qm-lime"
              />
              <div className="flex justify-between text-xs text-qm-gray mt-1">
                <span>1 Simple</span>
                <span>3 Standard</span>
                <span>5 Expert</span>
              </div>
            </Field>

            {/* Status radio */}
            <Field label="Status">
              <div className="grid grid-cols-4 gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <label
                    key={s.value}
                    className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 cursor-pointer transition-all ${
                      form.status === s.value ? s.style + ' font-semibold' : 'border-gray-200 text-qm-gray hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      checked={form.status === s.value}
                      onChange={() => setForm({ ...form, status: s.value })}
                      className="sr-only"
                    />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
            <p className="text-sm font-medium text-qm-black">Advanced Settings</p>
            <p className="mt-1 text-sm text-qm-gray">Coming next — income/COG accounts, QB Desktop item type, commissions, sales type.</p>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
            <p className="text-sm font-medium text-qm-black">Configure Pricing</p>
            <p className="mt-1 text-sm text-qm-gray">Coming next — pricing type, formulas, triangle, discounts, default items, modifiers, dropdown menus.</p>
          </div>
        )}

        {activeTab === 'custom-fields' && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
            <p className="text-sm font-medium text-qm-black">Custom Fields</p>
            <p className="mt-1 text-sm text-qm-gray">Coming after the pricing tab.</p>
          </div>
        )}
      </div>
    </>
  )
}

const inputClass = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}
