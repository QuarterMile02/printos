// My Tasks — empty state for now. There's no `tasks` table in the
// schema yet (verified via `grep "CREATE TABLE.*tasks"` against
// supabase/migrations). When that table lands the widget will swap in
// a real query keyed on assignee_id; the chrome and empty state stay
// the same so users won't see a layout shift.

import WidgetCard from './widget-card'

export default function MyTasks() {
  return (
    <WidgetCard title="My Tasks" span={6}>
      <div className="py-8 text-center text-sm text-gray-500">
        You&apos;re all done! 👌
        <p className="mt-1 text-xs text-gray-400">
          The tasks table isn&apos;t in the schema yet — this widget will populate once tasks ship.
        </p>
      </div>
    </WidgetCard>
  )
}
