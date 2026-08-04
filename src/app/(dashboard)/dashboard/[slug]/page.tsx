import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { hasPermission, type Role, type Tier } from '@/lib/permissions'
import { checkPermission } from '@/lib/check-permission'
import { WIDGETS, type WidgetId } from './_widgets/registry'
import {
  resolveWidgetOrder,
  widgetOrderToConfig,
  WIDGET_META,
  type WidgetConfig,
} from '@/lib/dashboard/widget-registry'
import DashboardGrid from './_widgets/dashboard-grid'
import DashboardAlertStrip from './dashboard-alert-strip'

// Widget components
import ApproachingDeadlineWidget from './_widgets/ApproachingDeadlineWidget'
import FileErrorWidget from './_widgets/FileErrorWidget'
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
import DepartmentQueueWidget from './_widgets/DepartmentQueueWidget'
import DesignQueueWidget from './_widgets/DesignQueueWidget'
import LowStockWidget from './_widgets/LowStockWidget'
import MySalesLeads from './_widgets/my-sales-leads'
import QuotesWithoutContact from './_widgets/quotes-without-contact'
import KpiSummary from './_widgets/kpi-summary'
import SalesPipeline from './_widgets/sales-pipeline'
import CollectionCalls from './_widgets/collection-calls'
import PaymentPromiseTracker from './_widgets/payment-promise-tracker'
import QuotesNeedingApproval from './_widgets/quotes-needing-approval'
import RescueList from './_widgets/rescue-list'
import { WidgetStub } from './_widgets/widget-card'
import type { DateRangePreset } from '@/lib/reports/report-utils'
import { dbOrThrow } from '@/lib/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ bi_preset?: string; bi_mode?: string }>
}

export default async function DashboardPage(props: PageProps) {
  try {
    return await DashboardPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[dashboard-overview] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (dashboard-overview)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function DashboardPageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const service = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  // Resolve role + tier (profile → fallback to org_members)
  let role: Role = 'production'
  let tier: Tier = 'staff'
  let displayName: string | null = null
  let userDepartments: string[] = []
  const { data: profile } = await service
    .from('profiles').select('role, tier, full_name, departments').eq('id', user.id).maybeSingle() as {
      data: { role: Role | null; tier: Tier | null; full_name: string | null; departments: string[] | null } | null; error: unknown
    }
  if (profile) {
    role = (profile.role as Role) ?? 'production'
    tier = (profile.tier as Tier) ?? 'staff'
    displayName = profile.full_name
    userDepartments = profile.departments ?? []
  } else {
    const { data: mem } = await service
      .from('organization_members').select('role').eq('user_id', user.id).eq('organization_id', org.id).maybeSingle() as {
        data: { role: string } | null; error: unknown
      }
    if (mem && (mem.role === 'owner' || mem.role === 'admin')) { role = 'owner'; tier = 'manager' }
  }

  // Permission: staff never see Edit Layout button
  const { allowed: canCustomize } = await checkPermission(org.id, 'dashboard.customize')
  const canCreateQuotes    = hasPermission({ role, tier }, [], 'quotes.create')
  const canCreateCustomers = hasPermission({ role, tier }, [], 'customers.create')

  const biPreset = (sp.bi_preset as DateRangePreset) ?? 'this_month'
  const biMode: 'count' | 'value' = sp.bi_mode === 'value' ? 'value' : 'count'

  // Load saved layout for this user+org
  type LayoutRow = { widget_config: WidgetConfig }
  const { data: layoutRow } = await service
    .from('dashboard_layouts')
    .select('widget_config')
    .eq('user_id', user.id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: LayoutRow | null; error: unknown }

  const savedConfig = layoutRow?.widget_config ?? null

  // Merge saved config against role defaults → final ordered ID list
  const orderedIds = resolveWidgetOrder(role, tier, savedConfig)

  // Widgets the user's role allows but aren't currently in their layout
  const orderedSet    = new Set(orderedIds)
  const availableToAdd = Object.keys(WIDGET_META).filter(
    (id) =>
      !orderedSet.has(id) &&
      WIDGET_META[id]?.visibleTo(role, tier) &&
      // Only offer built widgets in the catalog
      (WIDGETS.find((w) => w.id === id)?.built ?? false),
  )

  // ── Render each widget by id ─────────────────────────────────────────────
  function renderWidget(id: WidgetId) {
    switch (id) {
      case 'alert_bar':           return <AlertBar service={service} orgId={org!.id} orgSlug={slug} />
      case 'quick_create':        return <QuickCreate orgSlug={slug} role={role} canCreateQuotes={canCreateQuotes} canCreateCustomers={canCreateCustomers} />
      case 'my_job_assignments':  return <MyJobAssignments service={service} orgSlug={slug} orgId={org!.id} userId={user!.id} />
      case 'my_tasks':            return <MyTasks service={service} orgId={org!.id} userId={user!.id} orgSlug={slug} />
      case 'recent_activity':     return <RecentActivity service={service} orgId={org!.id} orgSlug={slug} userId={user!.id} role={role} />
      case 'bi_stats':            return <BiStats service={service} orgId={org!.id} orgSlug={slug} preset={biPreset} mode={biMode} />
      case 'production_control':  return <ProductionControl service={service} orgId={org!.id} orgSlug={slug} />
      case 'aging_buckets':       return <AgingBuckets service={service} orgId={org!.id} orgSlug={slug} />
      case 'sales_chart':         return <SalesChartWidget orgId={org!.id} />
      case 'conversion_ratio':    return <ConversionRatioWidget service={service} orgId={org!.id} />
      case 'quotes_priority':     return <QuotesPriorityWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'collection_calls':    return <CollectionCalls service={service} orgId={org!.id} orgSlug={slug} />
      case 'payment_promise_tracker': return <PaymentPromiseTracker service={service} orgId={org!.id} orgSlug={slug} />
      case 'quotes_needing_approval': return <QuotesNeedingApproval service={service} orgId={org!.id} orgSlug={slug} />
      case 'rescue_list':         return <RescueList service={service} orgId={org!.id} orgSlug={slug} />
      case 'department_queue':    return <DepartmentQueueWidget service={service} orgId={org!.id} orgSlug={slug} role={role} userDepartments={userDepartments} />
      case 'approaching_deadline': return <ApproachingDeadlineWidget service={service} orgId={org!.id} orgSlug={slug} userId={user!.id} role={role} />
      case 'file_error':          return <FileErrorWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'design_queue':        return <DesignQueueWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'low_stock_materials': return <LowStockWidget service={service} orgId={org!.id} orgSlug={slug} />
      case 'sales_leads':         return <MySalesLeads service={service} orgId={org!.id} orgSlug={slug} userId={user!.id} />
      case 'quotes_without_contact': return <QuotesWithoutContact service={service} orgId={org!.id} orgSlug={slug} />
      case 'kpi_summary':         return <KpiSummary service={service} orgId={org!.id} />
      case 'sales_pipeline':      return <SalesPipeline service={service} orgId={org!.id} orgSlug={slug} />
      default: {
        const def = WIDGETS.find((w) => w.id === id)
        return <WidgetStub title={def?.title ?? id} span={def?.span ?? 12} role={role} />
      }
    }
  }

  // Build widgetMap: pre-render each visible widget server-side
  const widgetMap: Record<string, React.ReactNode> = {}
  for (const id of orderedIds) {
    widgetMap[id] = renderWidget(id as WidgetId)
  }

  // ── Persist the resolved default on first visit so re-order has a baseline
  // Only write if there's no saved row yet — avoids overwriting on every load.
  if (!layoutRow) {
    const defaultConfig = widgetOrderToConfig(orderedIds)
    // Best-effort, non-blocking. Failures are silent — layout still renders.
    void service.from('dashboard_layouts').upsert(
      {
        user_id: user.id,
        organization_id: org.id,
        widget_config: defaultConfig,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,organization_id' },
    )
  }

  return (
    <div className="p-8 max-w-7xl">
      {/* Persistent alert strip — hidden when nothing is actionable */}
      <DashboardAlertStrip service={service} orgId={org.id} orgSlug={slug} />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-[#1A1A1A]">
            {displayName ? `Welcome back, ${displayName.split(' ')[0]}` : 'Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-semibold capitalize">{role}</span>
            {' · '}
            <span className="capitalize">{tier}</span>
            {' · '}
            {org.name}
          </p>
        </div>
      </div>

      {/* Grid — client handles drag, add/remove, save */}
      <DashboardGrid
        widgetMap={widgetMap}
        orderedIds={orderedIds}
        availableToAdd={availableToAdd}
        canCustomize={canCustomize}
        orgId={org.id}
        orgSlug={slug}
      />
    </div>
  )
}
