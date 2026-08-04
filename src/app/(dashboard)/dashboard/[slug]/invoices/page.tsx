import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { INVOICES_PAGE_SIZE } from './constants'
import InvoicesListClient, { type InvoiceListRow } from './invoices-list-client'
import { dbOrThrow, DbError } from '@/lib/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ overdue_bucket?: string }>
}

type OverdueBucket = '0-30' | '31-60' | '61-90' | '90+'

const BUCKET_LABELS: Record<OverdueBucket, string> = {
  '0-30': '0-30 days',
  '31-60': '31-60 days',
  '61-90': '61-90 days',
  '90+': '90+ days',
}

function bucketDateRange(bucket: OverdueBucket): { gte?: string; lt?: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const offset = (days: number) => iso(new Date(today.getTime() - days * dayMs))
  switch (bucket) {
    case '0-30': return { gte: offset(30), lt: iso(today) }
    case '31-60': return { gte: offset(60), lt: offset(30) }
    case '61-90': return { gte: offset(90), lt: offset(60) }
    case '90+': return { lt: offset(90) }
  }
}

const DB_SELECT = 'id, invoice_number, title, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)'

export default async function InvoicesPage(props: PageProps) {
  try {
    return await InvoicesPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[invoices-list] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (invoices-list)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function InvoicesPageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'invoices.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-extrabold text-qm-black">Invoices</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view invoices. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const memberRows = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id)
  ) as MemberRow[] | null

  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const bucketKey = sp.overdue_bucket as OverdueBucket | undefined
  const isValidBucket = bucketKey === '0-30' || bucketKey === '31-60' || bucketKey === '61-90' || bucketKey === '90+'

  let initialRows: InvoiceListRow[]
  let initialTotalCount: number

  if (isValidBucket) {
    // Special multi-condition filter (status NOT IN + due_date range) that
    // fetchDataTablePage's generic FilterRule grammar can't express — bypass
    // it here, matching the aging-buckets widget's own query exactly.
    const range = bucketDateRange(bucketKey)
    let query = supabase
      .from('invoices')
      .select(DB_SELECT)
      .eq('organization_id', org.id)
      .not('status', 'in', '(paid,void,draft)')
      .order('invoice_number', { ascending: false })
    let countQuery = supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .not('status', 'in', '(paid,void,draft)')
    if (range.gte) {
      query = query.gte('due_date', range.gte) as typeof query
      countQuery = countQuery.gte('due_date', range.gte) as typeof countQuery
    }
    if (range.lt) {
      query = query.lt('due_date', range.lt) as typeof query
      countQuery = countQuery.lt('due_date', range.lt) as typeof countQuery
    }
    const [rowsRes, countRes] = await Promise.all([query.limit(INVOICES_PAGE_SIZE), countQuery])
    if (rowsRes.error) throw new DbError(rowsRes.error)
    if (countRes.error) throw new DbError(countRes.error)
    initialRows = (rowsRes.data ?? []) as InvoiceListRow[]
    initialTotalCount = countRes.count ?? 0
  } else {
    const result = await fetchDataTablePage({
      tableKey: 'invoices',
      orgId: org.id,
      select: DB_SELECT,
      filterRules: [],
      sortRules: [{ column: 'invoice_number', direction: 'desc' }],
      page: 1,
      pageSize: INVOICES_PAGE_SIZE,
    })
    initialRows = result.rows as InvoiceListRow[]
    initialTotalCount = result.totalCount
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Invoices</span>
        </div>
        <h1 className="text-2xl font-extrabold text-qm-black">Invoices</h1>
      </div>

      <InvoicesListClient
        key={bucketKey ?? 'none'}
        initialRows={initialRows}
        initialTotalCount={initialTotalCount}
        orgSlug={org.slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        initialBucket={isValidBucket ? { key: bucketKey, label: BUCKET_LABELS[bucketKey] } : undefined}
      />
    </div>
  )
}
