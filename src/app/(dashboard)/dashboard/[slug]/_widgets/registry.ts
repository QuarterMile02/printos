import type { Role, Tier } from '@/lib/permissions'

export type WidgetId =
  // Universal
  | 'alert_bar' | 'quick_create' | 'my_job_assignments' | 'my_tasks' | 'recent_activity'
  // Manager / owner analytics
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
  | 'design_queue' | 'approaching_deadline' | 'file_error'

export type WidgetDef = {
  id: WidgetId
  title: string
  visibleTo: (role: Role, tier: Tier) => boolean
  span: number
  built: boolean
}

const isOwner           = (r: Role) => r === 'owner'
const isSales           = (r: Role) => r === 'sales'
const isAccounting      = (r: Role) => r === 'accounting'
const isDesigner        = (r: Role) => r === 'designer'
const isProductionFloor = (r: Role) => r === 'production' || r === 'installer'
const isManagerOrLead   = (t: Tier) => t === 'manager' || t === 'lead'

export const WIDGETS: WidgetDef[] = [
  // ─── Universal ────────────────────────────────────────────────────────
  { id: 'alert_bar',           title: 'Alerts',                      visibleTo: () => true,                                                                        span: 12, built: true  },
  { id: 'quick_create',        title: 'Quick Create',                visibleTo: () => true,                                                                        span: 12, built: true  },
  { id: 'my_job_assignments',  title: 'My Job Assignments',          visibleTo: () => true,                                                                        span: 6,  built: true  },
  { id: 'my_tasks',            title: 'My Tasks',                    visibleTo: () => true,                                                                        span: 6,  built: true  },
  { id: 'recent_activity',     title: 'Recent Activity',             visibleTo: () => true,                                                                        span: 12, built: true  },

  // ─── Owner + Manager analytics ────────────────────────────────────────
  { id: 'bi_stats',            title: 'Business Intelligence',       visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t),                                       span: 12, built: true  },
  { id: 'production_control',  title: 'Production Control',          visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t),                                       span: 6,  built: true  },
  { id: 'aging_buckets',       title: 'Overdue Invoices Aging',      visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t),                                       span: 6,  built: true  },
  { id: 'sales_chart',         title: 'Sales Chart',                 visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || isAccounting(r),                   span: 12, built: true  },
  { id: 'conversion_ratio',    title: 'Conversion Ratio',            visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || isAccounting(r),                   span: 6,  built: true  },

  // ─── Sales role (+ owner / managers) ─────────────────────────────────
  { id: 'quotes_priority',        title: 'Quotes Priority',          visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t),                        span: 6,  built: true  },
  { id: 'sales_leads',            title: 'My Sales Leads',           visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t),                        span: 6,  built: true  },
  { id: 'quotes_without_contact', title: 'Quotes Without Contact',   visibleTo: (r, t) => isSales(r) || isOwner(r) || isManagerOrLead(t),                        span: 6,  built: true  },
  { id: 'sales_pipeline',         title: 'Sales Team Pipeline',      visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t),                                       span: 12, built: true  },

  // ─── Owner only ───────────────────────────────────────────────────────
  { id: 'kpi_summary',            title: 'KPI Department Summary',   visibleTo: (r) => isOwner(r),                                                               span: 12, built: true  },

  // ─── Accounting role (+ owner / managers) ────────────────────────────
  { id: 'completed_not_invoiced',  title: 'Completed Jobs Not Invoiced', visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t),              span: 6,  built: false },
  { id: 'collection_calls',        title: 'Collection Calls',            visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t),              span: 6,  built: true  },
  { id: 'payment_promise_tracker', title: 'Payment Promise Tracker',     visibleTo: (r, t) => isAccounting(r) || isOwner(r) || isManagerOrLead(t),              span: 6,  built: true  },

  // ─── Sales Manager / Owner approvals ─────────────────────────────────
  { id: 'quotes_needing_approval', title: 'Quotes Needing Approval', visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || (isSales(r) && t === 'manager'),  span: 6,  built: true  },
  { id: 'rescue_list',             title: 'Rescue List',             visibleTo: (r, t) => isOwner(r) || isManagerOrLead(t) || (isSales(r) && t === 'manager'),  span: 6,  built: true  },

  // ─── Production + Installer (+ owner + managers) ─────────────────────
  { id: 'department_queue',    title: 'Department Queue',            visibleTo: (r, t) => isProductionFloor(r) || isOwner(r) || isManagerOrLead(t),              span: 6,  built: true  },
  { id: 'low_stock_materials', title: 'Low Stock Materials',         visibleTo: (r, t) => isProductionFloor(r) || isOwner(r) || isAccounting(r) || isManagerOrLead(t), span: 12, built: true  },

  // ─── Designer (+ owner + managers) ───────────────────────────────────
  { id: 'design_queue',         title: 'Design Queue',              visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t),                     span: 12, built: true  },
  { id: 'approaching_deadline', title: 'Approaching Deadlines',     visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t),                     span: 6,  built: true  },
  { id: 'file_error',           title: 'File Errors',               visibleTo: (r, t) => isDesigner(r) || isOwner(r) || isManagerOrLead(t),                     span: 6,  built: true  },
]

export function visibleWidgetsFor(role: Role, tier: Tier): WidgetDef[] {
  return WIDGETS.filter((w) => w.visibleTo(role, tier))
}

export function canCustomizeDashboard(role: Role, tier: Tier): boolean {
  return role === 'owner' || isManagerOrLead(tier)
}
