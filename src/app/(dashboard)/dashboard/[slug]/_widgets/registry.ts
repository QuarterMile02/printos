// Dashboard widget registry — single source of truth for which widgets
// exist, who sees them, and their default order. The dashboard page
// reads this to decide what to render. Customization (next turn) will
// override this via dashboard_layouts.widget_config.

import type { Role, Tier } from '@/lib/permissions'

export type WidgetId =
  // Universal
  | 'alert_bar' | 'quick_create' | 'my_job_assignments' | 'my_tasks' | 'recent_activity'
  // Owner + sales manager
  | 'sales_chart' | 'bi_stats' | 'production_control' | 'conversion_ratio' | 'aging_buckets'
  | 'kpi_summary' | 'sales_pipeline'
  // Sales role
  | 'quotes_priority' | 'sales_leads' | 'quotes_without_contact'
  | 'quotes_needing_approval' | 'rescue_list'
  // Accounting role
  | 'completed_not_invoiced' | 'collection_calls' | 'payment_promise_tracker'
  // Production / installer
  | 'department_queue' | 'low_stock_materials'
  // Designer
  | 'design_queue'

export type WidgetDef = {
  id: WidgetId
  title: string
  // null = visible to everyone. Otherwise a role/tier predicate.
  visibleTo: (role: Role, tier: Tier) => boolean
  // Spans 12-col grid: 1 = 1/12 width, 12 = full row.
  span: number
  // True for widgets I've fully built this turn. False = stub.
  built: boolean
}

const isOwner            = (role: Role) => role === 'owner'
const isSales            = (role: Role) => role === 'sales'
const isAccounting       = (role: Role) => role === 'accounting'
const isDesigner         = (role: Role) => role === 'designer'
const isProductionFloor  = (role: Role) => role === 'production' || role === 'installer'
const isOwnerOrSalesMgr  = (role: Role, tier: Tier) => role === 'owner' || (role === 'sales' && tier === 'manager')
const isManagerOrLead    = (tier: Tier) => tier === 'manager' || tier === 'lead'

export const WIDGETS: WidgetDef[] = [
  // ─── Universal ────────────────────────────────────────────────────
  { id: 'alert_bar',           title: 'Alerts',                 visibleTo: () => true,                       span: 12, built: true  },
  { id: 'quick_create',        title: 'Quick Create',           visibleTo: () => true,                       span: 12, built: true  },
  { id: 'my_job_assignments',  title: 'My Job Assignments',     visibleTo: () => true,                       span: 6,  built: true  },
  { id: 'my_tasks',            title: 'My Tasks',               visibleTo: () => true,                       span: 6,  built: true  },
  { id: 'recent_activity',     title: 'Recent Activity',        visibleTo: () => true,                       span: 12, built: true  },

  // ─── Owner + Sales Manager ────────────────────────────────────────
  { id: 'bi_stats',            title: 'Business Intelligence',  visibleTo: (r, t) => isOwnerOrSalesMgr(r, t), span: 12, built: true  },
  { id: 'production_control',  title: 'Production Control',     visibleTo: (r, t) => isOwnerOrSalesMgr(r, t), span: 6,  built: true  },
  { id: 'aging_buckets',       title: 'Overdue Invoices Aging', visibleTo: (r, t) => isOwnerOrSalesMgr(r, t), span: 6,  built: true  },
  // sales_chart: owner, sales manager, accounting per spec
  { id: 'sales_chart',         title: 'Sales Chart',            visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t) || isAccounting(r), span: 12, built: true  },
  // conversion_ratio: same audience as sales_chart
  { id: 'conversion_ratio',    title: 'Conversion Ratio',       visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t) || isAccounting(r), span: 6,  built: true  },

  // ─── Sales role (+ owner / sales manager) ────────────────────────
  { id: 'quotes_priority',        title: 'Quotes Priority',         visibleTo: (r) => isSales(r) || isOwner(r),                                  span: 6,  built: true  },
  { id: 'sales_leads',            title: 'My Sales Leads',          visibleTo: (r, t) => isSales(r) || isOwner(r) || isOwnerOrSalesMgr(r, t),    span: 6,  built: true  },
  { id: 'quotes_without_contact', title: 'Quotes Without Contact',  visibleTo: (r, t) => isSales(r) || isOwner(r) || isOwnerOrSalesMgr(r, t),    span: 6,  built: true  },
  { id: 'sales_pipeline',         title: 'Sales Team Pipeline',     visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t),                  span: 12, built: true  },

  // ─── Owner only ───────────────────────────────────────────────────
  { id: 'kpi_summary',            title: 'KPI Department Summary',  visibleTo: (r) => isOwner(r),                                                span: 12, built: true  },

  // ─── Accounting role (+ owner sees it on dashboard) ───────────────
  { id: 'completed_not_invoiced',  title: 'Completed Jobs Not Invoiced', visibleTo: (r) => isAccounting(r),                 span: 6,  built: false },
  { id: 'collection_calls',        title: 'Collection Calls',            visibleTo: (r) => isAccounting(r) || isOwner(r),   span: 6,  built: true  },
  { id: 'payment_promise_tracker', title: 'Payment Promise Tracker',     visibleTo: (r) => isAccounting(r) || isOwner(r),   span: 6,  built: true  },

  // ─── Sales Manager / Owner ───────────────────────────────────────
  { id: 'quotes_needing_approval', title: 'Quotes Needing Approval',     visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t), span: 6,  built: true  },
  { id: 'rescue_list',             title: 'Rescue List',                 visibleTo: (r, t) => isOwner(r) || isOwnerOrSalesMgr(r, t), span: 6,  built: true  },

  // ─── Production + Installer (+ owner + accounting) ──────────────
  { id: 'department_queue',    title: 'Department Queue',        visibleTo: (r) => isProductionFloor(r) || isOwner(r),                     span: 6,  built: true  },
  { id: 'low_stock_materials', title: 'Low Stock Materials',     visibleTo: (r) => isProductionFloor(r) || isOwner(r) || isAccounting(r),  span: 12, built: true  },

  // ─── Designer (+ owner + managers) ───────────────────────────────
  { id: 'design_queue',        title: 'Design Queue',            visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t), span: 12, built: true  },
]

export function visibleWidgetsFor(role: Role, tier: Tier): WidgetDef[] {
  return WIDGETS.filter((w) => w.visibleTo(role, tier))
}

// Customization gate (next turn). Owner / lead / manager get the
// "+ Add Widget" button; staff get the default layout only.
export function canCustomizeDashboard(role: Role, tier: Tier): boolean {
  return role === 'owner' || isManagerOrLead(tier)
}
