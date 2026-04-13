import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import type {
  Product, ProductCategory, WorkflowTemplate, PricingFormula, Discount,
  Material, LaborRate, MachineRate, Modifier,
  ProductDefaultItem, ProductModifier, ProductDropdownMenu, ProductDropdownItem,
  ProductCustomField,
} from '@/types/product-builder'
import ProductForm, { type ExistingDropdownMenu } from '../product-form'
import ProductFormErrorBoundary from './error-boundary'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function EditProductPage({ params }: PageProps) {
  try {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: { message: string } | null }

  if (!org) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm">
          <h1 className="text-lg font-bold text-red-800">Product Detail — Debug</h1>
          <p className="mt-2"><strong>slug:</strong> {slug}</p>
          <p><strong>id:</strong> {id}</p>
          <p><strong>org:</strong> null</p>
          <p><strong>org error:</strong> {orgError?.message ?? 'none (org not found for this slug)'}</p>
        </div>
      </div>
    )
  }

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle()

  if (!product) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm">
          <h1 className="text-lg font-bold text-red-800">Product Detail — Debug</h1>
          <p className="mt-2"><strong>slug:</strong> {slug}</p>
          <p><strong>id:</strong> {id}</p>
          <p><strong>org.id:</strong> {org.id}</p>
          <p><strong>org.name:</strong> {org.name}</p>
          <p><strong>product:</strong> null</p>
          <p><strong>product error:</strong> {productError?.message ?? 'none (product not found for this id + org)'}</p>
        </div>
      </div>
    )
  }

  const typedProduct = product as unknown as Product

  // Safe query helper — returns empty array if table doesn't exist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function safeQuery<T>(query: PromiseLike<any>): Promise<T[]> {
    try {
      const res = await query
      return (res?.data ?? []) as T[]
    } catch {
      return []
    }
  }

  const [
    categories, workflows, pricingFormulas, discounts,
    materials, laborRates, machineRates, modifiers,
    defaultItems, productModifiers, dropdownMenus, customFields,
  ] = await Promise.all([
    safeQuery<ProductCategory>(supabase.from('product_categories').select('*').eq('organization_id', org.id).order('name')),
    safeQuery<WorkflowTemplate>(supabase.from('workflow_templates').select('*').eq('organization_id', org.id).order('name')),
    safeQuery<PricingFormula>(supabase.from('pricing_formulas').select('*').or(`organization_id.eq.${org.id},is_system.eq.true`).order('name')),
    safeQuery<Discount>(supabase.from('discounts').select('*').eq('organization_id', org.id).eq('active', true).order('name')),
    safeQuery<Pick<Material, 'id' | 'name' | 'cost' | 'price' | 'selling_units' | 'material_type_id' | 'category_id' | 'active'>>(supabase.from('materials').select('id, name, cost, price, selling_units, material_type_id, category_id, active').eq('organization_id', org.id).eq('active', true).order('name')),
    safeQuery<Pick<LaborRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>>(supabase.from('labor_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name')),
    safeQuery<Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'units' | 'formula' | 'active'>>(supabase.from('machine_rates').select('id, name, cost, price, units, formula, active').eq('organization_id', org.id).eq('active', true).order('name')),
    safeQuery<Modifier>(supabase.from('modifiers').select('*').eq('organization_id', org.id).eq('active', true).order('display_name')),
    safeQuery<ProductDefaultItem>(supabase.from('product_default_items').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order')),
    safeQuery<ProductModifier>(supabase.from('product_modifiers').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order')),
    safeQuery<ProductDropdownMenu>(supabase.from('product_dropdown_menus').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order')),
    safeQuery<ProductCustomField>(supabase.from('product_custom_fields').select('*').eq('product_id', id).eq('organization_id', org.id).order('sort_order')),
  ])

  // Fetch dropdown items for all the menus in one query
  const menuIds = dropdownMenus.map((m) => m.id)
  let dropdownItems: ProductDropdownItem[] = []
  if (menuIds.length > 0) {
    dropdownItems = await safeQuery<ProductDropdownItem>(
      supabase.from('product_dropdown_items').select('*').in('dropdown_menu_id', menuIds).order('sort_order')
    )
  }

  // Group items by menu
  const existingDropdownMenus: ExistingDropdownMenu[] = dropdownMenus.map((menu) => ({
    menu_name: menu.menu_name,
    is_optional: menu.is_optional ?? false,
    items: dropdownItems
      .filter((i) => i.dropdown_menu_id === menu.id)
      .map((i) => ({
        item_type: (i.item_type as 'Material' | 'LaborRate' | 'MachineRate') ?? 'Material',
        material_id: i.material_id,
        labor_rate_id: i.labor_rate_id,
        machine_rate_id: i.machine_rate_id,
        system_formula: i.system_formula,
        charge_per_li_unit: i.charge_per_li_unit ?? false,
        is_optional: i.is_optional ?? false,
      })),
  }))

  return (
    <div className="p-8 w-full">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
          <span>/</span>
          <Link href={`/dashboard/${slug}/products`} className="hover:text-gray-700">Products</Link>
          <span>/</span>
          <span className="text-gray-700">{typedProduct.name}</span>
        </div>
      </div>

      {/* Server-rendered product summary — always visible */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-extrabold text-gray-900">{typedProduct.name}</h1>
        {typedProduct.description && <p className="mt-1 text-sm text-gray-600">{typedProduct.description}</p>}
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Pricing Type</span>
            <p className="mt-0.5 text-gray-900">{typedProduct.pricing_type ?? '—'}</p>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Formula</span>
            <p className="mt-0.5 text-gray-900">{typedProduct.formula ?? '—'}</p>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Price</span>
            <p className="mt-0.5 text-gray-900">${Number(typedProduct.price ?? 0).toFixed(2)}</p>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Status</span>
            <p className="mt-0.5 text-gray-900 capitalize">{typedProduct.status ?? 'draft'}</p>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Taxable</span>
            <p className="mt-0.5 text-gray-900">{typedProduct.taxable ? 'Yes' : 'No'}</p>
          </div>
        </div>
      </div>

      {/* Client-rendered product form — wrapped in error boundary */}
      <ProductFormErrorBoundary productName={typedProduct.name}>
        <Suspense fallback={<div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading editor...</div>}>
          <ProductForm
            orgId={org.id}
            orgSlug={slug}
            product={typedProduct}
            categories={categories}
            workflows={workflows}
            pricingFormulas={pricingFormulas}
            discounts={discounts}
            materials={materials}
            laborRates={laborRates}
            machineRates={machineRates}
            modifiersList={modifiers}
            existingDefaultItems={defaultItems}
            existingModifiers={productModifiers}
            existingDropdownMenus={existingDropdownMenus}
            existingCustomFields={customFields}
          />
        </Suspense>
      </ProductFormErrorBoundary>
    </div>
  )
  } catch (err) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm">
          <h1 className="text-lg font-bold text-red-800">Product Detail — Caught Error</h1>
          <pre className="mt-2 whitespace-pre-wrap text-red-700">{err instanceof Error ? err.stack ?? err.message : String(err)}</pre>
        </div>
      </div>
    )
  }
}
