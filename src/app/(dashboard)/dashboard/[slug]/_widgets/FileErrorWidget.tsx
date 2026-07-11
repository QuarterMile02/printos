import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string }

type JobRow = { id: string; title: string; created_at: string }

function hoursAgo(iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'Just now' : `${h}h ago`
}

export default async function FileErrorWidget({ service, orgId, orgSlug }: Props) {
  try {
    const { data, error } = await service
      .from('jobs')
      .select('id, title, created_at')
      .eq('organization_id', orgId)
      .eq('flag', 'file_error')
      .not('status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: false })
      .limit(5) as { data: JobRow[] | null; error: unknown }

    if (error) {
      console.error('[file-error] query error:', error)
      return null
    }
    if (!data || data.length === 0) return null

    return (
      <WidgetCard title="🚨 File Errors" span={6}>
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1.5">
          <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-xs font-bold text-red-700">
            {data.length} file error{data.length !== 1 ? 's' : ''} need attention
          </span>
        </div>
        <ul className="space-y-1.5">
          {data.map((j) => (
            <li key={j.id}>
              <Link
                href={`/dashboard/${orgSlug}/jobs/${j.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 transition hover:bg-red-100"
              >
                <span className="flex-1 truncate text-sm font-medium text-[#1A1A1A]">{j.title}</span>
                <span className="flex-shrink-0 text-xs text-red-500">
                  Flagged {hoursAgo(j.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={`/dashboard/${orgSlug}/jobs?flag=file_error`}
          className="mt-3 block text-right text-xs font-semibold text-red-500 hover:underline"
        >
          View all →
        </Link>
      </WidgetCard>
    )
  } catch {
    return null
  }
}
