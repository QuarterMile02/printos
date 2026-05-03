// New role-based dashboard. Replaces the legacy 938-line page that
// rendered the same view for every user. The layout is driven by
// _widgets/registry.ts — each role+tier gets a filtered widget list,
// rendered into a 12-col grid.
//
// Customization (drag to reorder, add/remove widgets) ships next turn.
// The dashboard_layouts table from migration 039 already exists for it.
//
// Built widgets land server-side; stubs use the shared WidgetStub. When
// a widget is upgraded, replace its stub case with the real component
// and flip `built: true` in the registry.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { hasPermission, type Role, type Tier } from '@/lib/permissions'
import { visibleWidgetsFor, canCustomizeDashboard, type WidgetId } from './_widgets/registry'
import { WidgetStub } from './_widgets/widget-card'
import AlertBar from './_widgets/alert-bar'
import QuickCreate from './_widgets/quick-create'
import MyJobAssignments from './_widgets/my-job-assignments'
import MyTasks from './_widgets/my-tasks'
import RecentActivity from './_widgets/recent-activity'
import BiStats from './_widgets/bi-stats'
import ProductionControl from './_widgets/production-control'
import AgingBuckets from './_widgets/aging-buckets'
import SalesChartWidget from './_widgets/SalesChartWidget'
import ConversionRatioWidget from './_widgets/ConversionRatioWidget'
import QuotesPriorityWidget from './_widgets/QuotesPriorityWidget'
import CollectionCallWidget from './_widgets/CollectionCallWidget'
import DepartmentQueueWidget from './_widgets/DepartmentQueueWidget'
import DesignQueueWidget from './_widgets/DesignQueueWidget'
import LowStockWidget from './_widgets/LowStockWidget'
import type { DateRangePreset } from '@/lib/reports/report-utils'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ bi_preset?: string; bi_mode?: string }>
}

export default async function DashboardPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const service = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: org } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
  if (!org) notFound()

  // Resolve role + tier. Profile may not have a row yet for orgs where
  // the trigger missed; fall back to org_members so we don't crash.
  let role: Role = 'production'
  let tier: Tier = 'staff'
  let displayName: string | null = null
  const { data: profile } = await service
    .from('profiles').select('role, tier, full_name').eq('id', user.id).maybeSingle() as {
      data: { role: Role | null; tier: Tier | null; full_name: string | null } | null; error: unknown
    }
  if (profile) {
    role = (profile.role as Role) ?? 'production'
    tier = (profile.tier as Tier) ?? 'staff'
    displayName = profile.full_name
  } else {
    const { data: mem } = await service
      .from('organization_members').select('role').eq('user_id', user.id).eq('organization_id', org.id).maybeSingle() as {
        data: { role: string } | null; error: unknown
      }
    if (mem && (mem.role === 'owner' || mem.role === 'admin')) { role = 'owner'; tier = 'manager' }
  }

  const canCreateQuotes = hasPermission({ role, tier }, [], 'quotes.create')
  const canCreateCustomers = hasPermission({ role, tier }, [], 'customers.create')

  // BI Stats searchParams (preset + count/value mode). Defaulted here
  // so the widget always has a deterministic state on first load.
  const biPreset = (sp.bi_preset as DateRangePreset) ?? 'this_month'
  const biMode: 'count' | 'value' = sp.bi_mode === 'value' ? 'value' : 'count'

  const widgets = visibleWidgetsFor(role, tier)
  const showCustomize = canCustomizeDashboard(role, tier)

  // Render each widget by id. Stubs flow through WidgetStub so the slot
  // is still reserved — making it obvious what's wired vs. queued.
  function renderWidget(id: WidgetId, span: number, title: string) {
    switch (id) {
      case 'alert_bar':           return <AlertBar service={service} orgId={org!.id} orgSlug={slug} />
      case 'quick_create':        return <QuickCreate orgSlug={slug} role={role} canCreateQuotes={canCreateQuotes} canCreateCustomers={canCreateCustomers} />
      case 'my_job_assignments':  return <MyJobAssignments service={service} orgSlug={slug} orgId={org!.id} userId={user!.id} />
      case 'my_tasks':            return <MyTasks />
      case 'recent_activity':     return <RecentActivity service={service} orgId={org!.id} orgSlug={slug} userId={user!.id} role={role} />
      case 'bi_stats':            return <BiStats service={service} orgId={org!.id} orgSlug={slug} preset={biPreset} mode={biMode} />
      case 'production_control':  return <ProductionControl service={service} orgId={org!.id} orgSlug={slug} />
      case 'aging_buckets':       return <AgingBuckets service={service} orgId={org!.id} orgSlug={slug} />
      case 'sales_chart':         return <SalesChartWidget orgId={org!.id} />
      case 'conversion_ratio':    return <ConversionRatioWidget service={service} orgId={org!.id} />
      case 'quotes_priority':     return <QuotesPriorityWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'collection_calls':    return <CollectionCallWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'department_queue':    return <DepartmentQueueWidget orgId={org!.id} orgSlug={slug} />
      case 'design_queue':        return <DesignQueueWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'low_stock_materials': return <LowStockWidget service={service} orgId={org!.id} orgSlug={slug} />
      default:                    return <WidgetStub title={title} span={span} role={role} />
    }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[#1A1A1A]">
            {displayName ? `Welcome back, ${displayName.split(' ')[0]}` : 'Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-semibold capitalize">{role}</span> · <span className="capitalize">{tier}</span> · {org.name}
          </p>
        </div>
        {showCustomize && (
          <button
            type="button"
            disabled
            title="Customization UI lands next dashboard pass"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 disabled:cursor-not-allowed"
          >
            + Add Widget
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {widgets.map((w) => (
          <div key={w.id} className={`col-span-12 ${w.span === 6 ? 'lg:col-span-6' : 'lg:col-span-12'}`}>
            {renderWidget(w.id, w.span, w.title)}
          </div>
        ))}
      </div>
    </div>
  )
}
