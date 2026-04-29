import Link from 'next/link'

// Placeholder shown for reports whose pages haven't been wired yet.
// Routes correctly so the sidebar + index links work; replace with the
// full ReportShell + table when each report gets built out.

type Props = { orgSlug: string; title: string; description: string }

export default function ReportStub({ orgSlug, title, description }: Props) {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${orgSlug}/reports`} className="hover:text-gray-700">Reports</Link>
        <span>/</span>
        <span className="text-gray-700">{title}</span>
      </div>
      <h1 className="text-2xl font-extrabold text-[#1A1A1A]">{title}</h1>
      <p className="mt-1 text-sm text-gray-600">{description}</p>
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-sm font-semibold text-gray-700">Coming soon</p>
        <p className="mt-1 text-xs text-gray-500">
          The Quotes report is fully built as the canonical pattern. This report will be wired next using the same shell + filter + CSV export pattern.
        </p>
      </div>
    </div>
  )
}
