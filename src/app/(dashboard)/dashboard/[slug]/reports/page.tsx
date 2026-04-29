import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { REPORT_DEFS } from '@/lib/reports/report-utils'

type PageProps = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

export default async function ReportsIndex({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
  if (!org) notFound()

  // Anyone with reports.quotes (owner/sales/accounting) can land here.
  const { allowed } = await checkPermission(org.id, 'reports.quotes')
  if (!allowed) notFound()

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#1A1A1A]">Reports</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pick a report to drill into. Each opens with a date-range filter, sortable columns, and a CSV export.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_DEFS.map((r) => (
          <Link
            key={r.type}
            href={`/dashboard/${slug}/reports/${r.type}`}
            className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[#93ca3b] hover:shadow-md"
          >
            <h2 className="text-base font-bold text-[#1A1A1A] group-hover:text-[#93ca3b]">{r.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{r.description}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#93ca3b]">
              Open report
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
