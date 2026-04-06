import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Product, ProductCategory, WorkflowTemplate } from '@/types/product-builder'
import ProductForm from '../product-form'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function EditProductPage({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: Product | null; error: unknown }

  if (!product) notFound()

  const { data: categories } = await supabase
    .from('product_categories')
    .select('*')
    .eq('organization_id', org.id)
    .order('name') as { data: ProductCategory[] | null; error: unknown }

  const { data: workflows } = await supabase
    .from('workflow_templates')
    .select('*')
    .eq('organization_id', org.id)
    .order('name') as { data: WorkflowTemplate[] | null; error: unknown }

  return (
    <div className="p-8">
      <ProductForm
        orgId={org.id}
        orgSlug={slug}
        product={product}
        categories={categories ?? []}
        workflows={workflows ?? []}
      />
    </div>
  )
}
