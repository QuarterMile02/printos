// Dashboard widget registry — customization layer.
//
// This file is the single source of truth for:
//   - widget_id → display metadata (label, default column span)
//   - which roles/tiers can see each widget (used for "Add Widget" modal filtering)
//   - which widgets are pinned (cannot be removed by user)
//
// The _widgets/registry.ts file in the dashboard route folder drives the
// server-side render switch. This file drives the client-side customisation
// UI (drag order, add/remove, visibility). They share the same WidgetId union.
//
// Widget config persisted in dashboard_layouts.widget_config:
//   { "version": 1, "widgets": [{ "id": "alert_bar", "visible": true, "order": 0 }, ...] }

import type { Role, Tier } from '@/lib/permissions'

// ── Re-export WidgetId so callers can import from one place ──────────────────
export type { WidgetId } from '@/app/(dashboard)/dashboard/[slug]/_widgets/registry'

// ── Per-widget metadata ───────────────────────────────────────────────────────

export type WidgetMeta = {
  label: string
  defaultSpan: 6 | 12
  pinned: boolean
  visibleTo: (role: Role, tier: Tier) => boolean
}

const isOwner           = (r: Role) => r === 'owner'
const isSales           = (r: Role) => r === 'sales'
const isAccounting      = (r: Role) => r === 'accounting'
const isDesigner        = (r: Role) => r === 'designer'
const isProduction      = (r: Role) => r === 'production' || r === 'installer'
const isManagerOrLead   = (t: Tier) => t === 'manager' || t === 'lead'

export const WIDGET_META: Record<string, WidgetMeta> = {
  // ── Pinned / universal ─────────────────────────────────────────────────────
  alert_bar:          { label: 'Alerts',                      defaultSpan: 12, pinned: true,  visibleTo: () => true },
  quick_create:       { label: 'Quick Create',                defaultSpan: 12, pinned: true,  visibleTo: () => true },

  // ── Universal (movable) ────────────────────────────────────────────────────
  my_job_assignments: { label: 'My Job Assignments',          defaultSpan: 6,  pinned: false, visibleTo: () => true },
  my_tasks:           { label: 'My Tasks',                    defaultSpan: 6,  pinned: false, visibleTo: () => true },
  recent_activity:    { label: 'Recent Activity',             defaultSpan: 12, pinned: false, visibleTo: () => true },

  // ── Owner / Manager analytics ─────────────────────────────────────────────
  bi_stats:           { label: 'Business Intelligence',       defaultSpan: 12, pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) },
  production_control: { label: 'Production Control',          defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) },
  aging_buckets:      { label: 'Overdue Invoice Aging',       defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) },
  sales_chart:        { label: 'Sales Chart',                 defaultSpan: 12, pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || isAccounting(r) },
  conversion_ratio:   { label: 'Conversion Ratio',            defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || isAccounting(r) },

  // ── Sales (+ owner / managers) ────────────────────────────────────────────
  quotes_priority:        { label: 'Quotes Priority',             defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t) },
  sales_leads:            { label: 'My Sales Leads',              defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t) },
  quotes_without_contact: { label: 'Quotes Without Contact',      defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t) },
  sales_pipeline:         { label: 'Sales Team Pipeline',         defaultSpan: 12, pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) },

  // ── Owner only ────────────────────────────────────────────────────────────
  kpi_summary:            { label: 'KPI Department Summary',      defaultSpan: 12, pinned: false, visibleTo: (r) => isOwner(r) },

  // ── Accounting (+ owner / managers) ──────────────────────────────────────
  completed_not_invoiced:  { label: 'Completed Jobs Not Invoiced', defaultSpan: 6, pinned: false, visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t) },
  collection_calls:        { label: 'Collection Calls',            defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t) },
  payment_promise_tracker: { label: 'Payment Promise Tracker',     defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t) },

  // ── Sales Manager / Owner approvals ───────────────────────────────────────
  quotes_needing_approval: { label: 'Quotes Needing Approval', defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || (isSales(r) && t === 'manager') },
  rescue_list:             { label: 'Rescue List',             defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || (isSales(r) && t === 'manager') },

  // ── Production / Installer (+ owner + managers) ───────────────────────────
  department_queue:    { label: 'Department Queue',            defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isProduction(r) || isOwner(r) || isManagerOrLead(t) },
  low_stock_materials: { label: 'Low Stock Materials',         defaultSpan: 12, pinned: false, visibleTo: (r, t) => isProduction(r) || isOwner(r) || isAccounting(r) || isManagerOrLead(t) },

  // ── Designer (+ owner + managers) ────────────────────────────────────────
  design_queue:         { label: 'Design Queue',              defaultSpan: 12, pinned: false, visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t) },
  approaching_deadline: { label: 'Approaching Deadlines',     defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t) },
  file_error:           { label: 'File Errors',               defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t) },
}

// ── Saved config types ────────────────────────────────────────────────────────

export type SavedWidgetEntry = {
  id: string
  visible: boolean
  order: number
}

export type WidgetConfig = {
  version: 1
  widgets: SavedWidgetEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function resolveWidgetOrder(
  role: Role,
  tier: Tier,
  saved: WidgetConfig | null,
): string[] {
  const allowed = Object.entries(WIDGET_META)
    .filter(([, meta]) => meta.visibleTo(role, tier))
    .map(([id]) => id)

  if (!saved || saved.widgets.length === 0) {
    return allowed
  }

  const pinnedIds = allowed.filter((id) => WIDGET_META[id]?.pinned)

  const savedVisible = saved.widgets
    .filter((w) => w.visible && !WIDGET_META[w.id]?.pinned && allowed.includes(w.id))
    .sort((a, b) => a.order - b.order)
    .map((w) => w.id)

  const savedIds   = new Set(saved.widgets.map((w) => w.id))
  const newWidgets = allowed.filter((id) => !savedIds.has(id) && !WIDGET_META[id]?.pinned)

  return [...pinnedIds, ...savedVisible, ...newWidgets]
}

export function widgetOrderToConfig(orderedIds: string[]): WidgetConfig {
  return {
    version: 1,
    widgets: orderedIds.map((id, i) => ({ id, visible: true, order: i })),
  }
}
