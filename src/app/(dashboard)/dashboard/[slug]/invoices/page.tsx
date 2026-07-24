import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import InvoicesClient from './invoices-client'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string; overdue_bucket?: string }>
}

type OverdueBucket = '0-30' | '31-60' | '61-90' | '90+'

function bucketDateRange(bucket: OverdueBucket): { gte?: string; lt?: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const offset = (days: number) => iso(new Date(today.getTime() - days * dayMs))
  switch (bucket) {
    case '0-30':  return { gte: offset(30), lt: iso(today) }
    case '31-60': return { gte: offset(60), lt: offset(30) }
    case '61-90': return { gte: offset(90), lt: offset(60) }
    case '90+':   return { lt: offset(90) }
  }
}

export default async function Page({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'invoices.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view invoices. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  let query = supabase
    .from('invoices')
    .select('id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('invoice_number', { ascending: false })

  let countQuery = supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const filter = sp.status
  const bucket = sp.overdue_bucket as OverdueBucket | undefined

  if (filter && filter !== 'all') {
    query = query.eq('status', filter) as typeof query
    countQuery = countQuery.eq('status', filter) as typeof countQuery
  }

  if (bucket && (bucket === '0-30' || bucket === '31-60' || bucket === '61-90' || bucket === '90+')) {
    const range = bucketDateRange(bucket)
    query = query.not('status', 'in', '(paid,cancelled,draft)') as typeof query
    countQuery = countQuery.not('status', 'in', '(paid,cancelled,draft)') as typeof countQuery
    if (range.gte) {
      query = query.gte('due_date', range.gte) as typeof query
      countQuery = countQuery.gte('due_date', range.gte) as typeof countQuery
    }
    if (range.lt) {
      query = query.lt('due_date', range.lt) as typeof query
      countQuery = countQuery.lt('due_date', range.lt) as typeof countQuery
    }
  }

  const [rowsRes, countRes] = await Promise.all([query.limit(1000), countQuery])
  const rows = rowsRes.data
  const totalCount = countRes.count ?? 0
  const invoices = (rows ?? []) as {
    id: string; invoice_number: number; status: string; total: number; balance_due: number
    due_date: string | null; created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  }[]

  return (
    <InvoicesClient
      slug={slug}
      orgId={org.id}
      orgName={org.name}
      invoices={invoices}
      totalCount={totalCount}
      filter={filter ?? 'all'}
      bucket={bucket}
    />
  )
}
