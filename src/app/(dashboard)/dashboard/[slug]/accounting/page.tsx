import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import AccountingClient from './accounting-client'
import { postInvoices } from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'invoices.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Post to Accounting</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view accounting. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  const { data: invRows } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, subtotal, tax_total, total, created_at, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .eq('is_posted', false)
    .order('invoice_number', { ascending: false })

  type UnpostedInvoice = {
    id: string
    invoice_number: number
    status: string
    subtotal: number
    tax_total: number
    total: number
    created_at: string
    customers: { first_name: string | null; last_name: string | null; company_name: string | null } | null
  }

  const invoices = (invRows ?? []) as unknown as UnpostedInvoice[]

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Post to Accounting</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Post to Accounting</h1>

      <AccountingClient
        slug={slug}
        orgId={org.id}
        initialInvoices={invoices}
        postInvoices={postInvoices}
      />
    </div>
  )
}
