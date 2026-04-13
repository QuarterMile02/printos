import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SalesOrderStatus, JobStatus } from '@/types/database'
import SoDetailClient from './so-detail-client'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function SalesOrderDetailPage({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  type SoRow = {
    id: string
    so_number: number
    title: string | null
    status: SalesOrderStatus
    total: number | null
    notes: string | null
    quote_id: string | null
    customer_id: string | null
    created_at: string
    updated_at: string
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
      email: string | null
      phone: string | null
    } | null
  }

  const { data: so } = await supabase
    .from('sales_orders')
    .select(`
      id, so_number, title, status, total, notes, quote_id, customer_id,
      created_at, updated_at,
      customers(first_name, last_name, company_name, email, phone)
    `)
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: SoRow | null; error: unknown }

  if (!so) notFound()

  // Fetch parent quote info if linked
  type QuoteRef = { id: string; quote_number: number; title: string; created_at: string }
  let parentQuote: QuoteRef | null = null
  if (so.quote_id) {
    const { data: q } = await supabase
      .from('quotes')
      .select('id, quote_number, title, created_at')
      .eq('id', so.quote_id)
      .maybeSingle() as { data: QuoteRef | null; error: unknown }
    parentQuote = q
  }

  // Fetch child jobs
  type JobRow = {
    id: string
    job_number: number
    title: string
    status: JobStatus
    due_date: string | null
  }
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, job_number, title, status, due_date')
    .eq('source_quote_id', so.quote_id ?? '')
    .eq('organization_id', org.id)
    .order('job_number', { ascending: true }) as { data: JobRow[] | null; error: unknown }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/sales-orders`} className="hover:text-gray-700">Sales Orders</Link>
        <span>/</span>
        <span className="text-gray-700">SO-{String(so.so_number).padStart(4, '0')}</span>
      </div>

      <SoDetailClient
        orgId={org.id}
        orgSlug={slug}
        salesOrder={{
          id: so.id,
          so_number: so.so_number,
          title: so.title ?? '',
          status: so.status,
          total: so.total ?? 0,
          notes: so.notes,
          created_at: so.created_at,
          updated_at: so.updated_at,
          customer: so.customers ?? null,
        }}
        parentQuote={parentQuote}
        jobs={(jobs ?? []).map((j) => ({
          id: j.id,
          job_number: j.job_number,
          title: j.title,
          status: j.status,
          due_date: j.due_date,
        }))}
      />
    </div>
  )
}
