import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; userId: string; orgSlug: string }

type TaskRow = {
  id: string
  title: string
  priority: string
  due_date: string | null
  related_job_id: string | null
  related_quote_id: string | null
  related_customer_id: string | null
}

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  normal: 'bg-blue-100 text-blue-700',
  low:    'bg-gray-100 text-gray-500',
}

export default async function MyTasks({ service, orgId, userId, orgSlug }: Props) {
  let tasks: TaskRow[] = []
  try {
    const { data } = await service
      .from('tasks')
      .select('id, title, priority, due_date, related_job_id, related_quote_id, related_customer_id')
      .eq('organization_id', orgId)
      .eq('assigned_to', userId)
      .not('status', 'in', '(completed,cancelled)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(10) as { data: TaskRow[] | null; error: unknown }
    tasks = data ?? []
  } catch {
    // tasks table may not exist yet — graceful empty state
  }

  return (
    <WidgetCard title="My Tasks" span={6}>
      {tasks.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          You&apos;re all done! 👌
        </div>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => {
            const relatedHref = t.related_job_id
              ? `/dashboard/${orgSlug}/jobs/${t.related_job_id}`
              : t.related_quote_id
              ? `/dashboard/${orgSlug}/quotes/${t.related_quote_id}`
              : t.related_customer_id
              ? `/dashboard/${orgSlug}/customers/${t.related_customer_id}`
              : null
            const isOverdue = t.due_date && new Date(t.due_date) < new Date()
            return (
              <li key={t.id} className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
                <span className={`mt-0.5 inline-flex flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.normal}`}>
                  {t.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#1A1A1A]">{t.title}</p>
                  <div className="flex items-center gap-2">
                    {t.due_date && (
                      <span className={`text-xs ${isOverdue ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
                        {new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {relatedHref && (
                      <Link href={relatedHref} className="text-xs text-[#93ca3b] hover:underline">
                        View →
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
