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
  // Default 12-column grid span. 6 = half-width on lg, 12 = full-width.
  defaultSpan: 6 | 12
  // Pinned widgets always show and cannot be removed by the user.
  // Alerts and Quick Create are operational, not decorative.
  pinned: boolean
  // Same predicate as _widgets/registry.ts visibleTo — determines whether
  // this widget appears in the "Add Widget" modal for a given role.
  visibleTo: (role: Role, tier: Tier) => boolean
}

const isOwner           = (r: Role) => r === 'owner'
const isSales           = (r: Role) => r === 'sales'
const isAccounting      = (r: Role) => r === 'accounting'
const isDesigner        = (r: Role) => r === 'designer'
const isProduction      = (r: Role) => r === 'production' || r === 'installer'
const isOwnerOrSalesMgr = (r: Role, t: Tier) => r === 'owner' || (r === 'sales' && t === 'manager')
const isManagerOrLead   = (t: Tier) => t === 'manager' || t === 'lead'

export const WIDGET_META: Record<string, WidgetMeta> = {
  // ── Pinned / universal ─────────────────────────────────────────────────────
  alert_bar:          { label: 'Alerts',                      defaultSpan: 12, pinned: true,  visibleTo: () => true },
  quick_create:       { label: 'Quick Create',                defaultSpan: 12, pinned: true,  visibleTo: () => true },

  // ── Universal (movable) ────────────────────────────────────────────────────
  my_job_assignments: { label: 'My Job Assignments',          defaultSpan: 6,  pinned: false, visibleTo: () => true },
  my_tasks:           { label: 'My Tasks',                    defaultSpan: 6,  pinned: false, visibleTo: () => true },
  recent_activity:    { label: 'Recent Activity',             defaultSpan: 12, pinned: false, visibleTo: () => true },

  // ── Owner / Sales Manager ─────────────────────────────────────────────────
  bi_stats:           { label: 'Business Intelligence',       defaultSpan: 12, pinned: false, visibleTo: (r, t) => isOwnerOrSalesMgr(r, t) },
  production_control: { label: 'Production Control',          defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwnerOrSalesMgr(r, t) },
  aging_buckets:      { label: 'Overdue Invoice Aging',       defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwnerOrSalesMgr(r, t) },
  sales_chart:        { label: 'Sales Chart',                 defaultSpan: 12, pinned: false, visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t) || isAccounting(r) },
  conversion_ratio:   { label: 'Conversion Ratio',            defaultSpan: 6,  pinned: false, visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t) || isAccounting(r) },

  // ── Sales ─────────────────────────────────────────────────────────────────
  quotes_priority:    { label: 'Quotes Priority',             defaultSpan: 6,  pinned: false, visibleTo: (r) => isSales(r) || isOwner(r) },

  // ── Accounting ────────────────────────────────────────────────────────────
  collection_calls:   { label: 'Collection Calls',            defaultSpan: 6,  pinned: false, visibleTo: (r) => isAccounting(r) || isOwner(r) },

  // ── Production / Installer ────────────────────────────────────────────────
  department_queue:   { label: 'Department Queue',            defaultSpan: 6,  pinned: false, visibleTo: (r) => isProduction(r) || isOwner(r) },
  low_stock_materials:{ label: 'Low Stock Materials',         defaultSpan: 12, pinned: false, visibleTo: (r) => isProduction(r) || isOwner(r) || isAccounting(r) },

  // ── Designer ─────────────────────────────────────────────────────────────
  design_queue:       { label: 'Design Queue',                defaultSpan: 12, pinned: false, visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t) },
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

// Returns the full ordered list of widget IDs to render for a user,
// merging their saved config against the role default.
//
// Rules:
//   1. Pinned widgets always show at position 0 and 1, regardless of saved config.
//   2. Saved visible widgets appear next, in their saved order.
//   3. New widgets (not in saved config but in role's allowed list) are appended.
//   4. Widgets no longer in the role's allowed list are silently dropped.
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
  const savedMap  = new Map(saved.widgets.map((w) => [w.id, w]))

  // Saved visible, non-pinned, still in allowed — in saved order
  const savedVisible = saved.widgets
    .filter((w) => w.visible && !WIDGET_META[w.id]?.pinned && allowed.includes(w.id))
    .sort((a, b) => a.order - b.order)
    .map((w) => w.id)

  // New allowed widgets the user hasn't seen yet (appended at the end)
  const savedIds  = new Set(saved.widgets.map((w) => w.id))
  const newWidgets = allowed.filter((id) => !savedIds.has(id) && !WIDGET_META[id]?.pinned)

  return [...pinnedIds, ...savedVisible, ...newWidgets]
}

// Converts an ordered WidgetId array back into WidgetConfig for persistence.
export function widgetOrderToConfig(orderedIds: string[]): WidgetConfig {
  return {
    version: 1,
    widgets: orderedIds.map((id, i) => ({ id, visible: true, order: i })),
  }
}
