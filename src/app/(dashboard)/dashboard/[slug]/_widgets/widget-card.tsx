import type { ReactNode } from 'react'

// Outer chrome for every dashboard widget. Keeps spacing/border/title
// consistent so individual widgets don't need to repeat the layout boilerplate.

type Props = {
  title: string
  subtitle?: string   // optional secondary line under the title
  accent?: string     // optional CSS color for a 3px top border
  action?: ReactNode  // optional button/link in the header (e.g. date selector)
  span?: number       // 1-12 grid columns; defaults to full row
  children: ReactNode
}

export default function WidgetCard({ title, subtitle, accent, action, span = 12, children }: Props) {
  // Tailwind doesn't pick up dynamic classes, so map the small set we use.
  const colSpan: Record<number, string> = {
    3:  'lg:col-span-3',
    4:  'lg:col-span-4',
    6:  'lg:col-span-6',
    8:  'lg:col-span-8',
    12: 'lg:col-span-12',
  }
  const accentStyle = accent ? { borderTopColor: accent, borderTopWidth: 3, borderTopStyle: 'solid' as const } : undefined
  return (
    <section
      className={`col-span-12 ${colSpan[span] ?? 'lg:col-span-12'} rounded-xl border border-gray-200 bg-white shadow-sm`}
      style={accentStyle}
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#1A1A1A]">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-normal normal-case text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

// Stub used for the 8 widgets I'm not building this turn.
export function WidgetStub({ title, span = 12, role }: { title: string; span?: number; role: string }) {
  return (
    <WidgetCard title={title} span={span}>
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <p className="text-sm font-semibold text-gray-700">Coming soon</p>
        <p className="mt-1 text-xs text-gray-500">
          {title} for {role} role — widget framework + 8 other widgets are live; this one is queued for the next dashboard pass.
        </p>
      </div>
    </WidgetCard>
  )
}
