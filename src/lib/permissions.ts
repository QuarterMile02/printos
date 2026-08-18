// PrintOS — Role-based permission system
// Hardcoded role defaults + tier upgrades + per-user overrides from DB.
// Used by every server component and server action via hasPermission().

export type Role = 'owner' | 'sales' | 'designer' | 'production' | 'installer' | 'digital' | 'accounting'
export type Tier = 'staff' | 'lead' | 'manager'

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  sales: 'Sales',
  designer: 'Designer',
  production: 'Production',
  installer: 'Installer',
  digital: 'Digital',
  accounting: 'Accounting',
}

export const TIER_LABELS: Record<Tier, string> = {
  staff: 'Staff',
  lead: 'Lead',
  manager: 'Manager',
}

export const ALL_ROLES: Role[] = ['owner', 'sales', 'designer', 'production', 'installer', 'digital', 'accounting']
export const ALL_TIERS: Tier[] = ['staff', 'lead', 'manager']

export const ROLE_DEFAULTS: Record<Role, Record<string, boolean>> = {
  owner: {
    '*': true,
  },
  sales: {
    'jobs.print_label': true,
    'dashboard.overview': true,
    'dashboard.revenue': true,
    'dashboard.job_queue': true,
    'dashboard.metrics.own': true,
    'dashboard.metrics.all': true,
    'quotes.view': true,
    'quotes.create': true,
    'quotes.edit': true,
    'quotes.see_pricing': true,
    'quotes.discount_override': false,
    'quotes.send': true,
    'quotes.convert': true,
    'quotes.delete': false,
    'quotes.export_pdf': true,
    'sales_orders.view': true,
    'sales_orders.edit': true,
    'sales_orders.see_pricing': true,
    'shipping.view': true,
    'shipping.create': true,
    'jobs.view': true,
    'jobs.move_stages': true,
    'jobs.see_pricing': true,
    'jobs.flag': true,
    'jobs.time_tracking': true,
    'customers.view': true,
    'customers.create': true,
    'customers.edit': true,
    'customers.delete': false,
    'customers.see_invoice_history': true,
    'materials.view': true,
    'materials.see_pricing': true,
    'materials.edit_inventory': false,
    'purchase_orders.view': true,
    'purchase_orders.create': true,
    'purchase_orders.edit': true,
    'invoices.view': true,
    'invoices.create': false,
    'invoices.record_payment': false,
    'invoices.qb_export': false,
    'reports.quotes': true,
    'reports.sales_orders': true,
    'reports.jobs': true,
    'reports.customers': true,
    'reports.financial': false,
    'settings.email_templates': false,
    'settings.team_members.view': true,
    'settings.team_members.manage': false,
    'settings.email_signature.own': true,
    'portal_tiers.manage': false,
  },
  designer: {
    'dashboard.overview': true,
    'dashboard.job_queue': true,
    'dashboard.metrics.own': true,
    'quotes.view': false,
    'quotes.see_pricing': false,
    'jobs.view': true,
    'jobs.move_stages': true,
    'jobs.proofs': true,
    'jobs.see_pricing': false,
    'jobs.flag': true,
    'jobs.time_tracking': true,
    'customers.view': true,
    'customers.create': false,
    'customers.see_invoice_history': false,
    'materials.view': true,
    'materials.see_pricing': false,
    'invoices.view': false,
    'reports.jobs': true,
    'settings.email_signature.own': true,
    'portal_tiers.manage': false,
  },
  production: {
    'jobs.print_label': true,
    'dashboard.overview': true,
    'dashboard.job_queue': true,
    'dashboard.metrics.own': true,
    'quotes.view': false,
    'quotes.see_pricing': false,
    'jobs.view': true,
    'jobs.move_stages': true,
    'jobs.see_pricing': false,
    'jobs.flag': true,
    'jobs.time_tracking': true,
    'customers.view': true,
    'customers.create': false,
    'customers.see_invoice_history': false,
    'materials.view': true,
    'materials.see_pricing': false,
    'materials.edit_inventory': true,
    'invoices.view': false,
    'reports.jobs': true,
    'settings.email_signature.own': true,
    'portal_tiers.manage': false,
  },
  installer: {
    'jobs.print_label': true,
    'dashboard.overview': true,
    'dashboard.job_queue': true,
    'dashboard.metrics.own': true,
    'quotes.view': false,
    'quotes.see_pricing': false,
    'jobs.view': true,
    'jobs.move_stages': true,
    'jobs.see_pricing': false,
    'jobs.flag': true,
    'jobs.time_tracking': true,
    'customers.view': true,
    'customers.create': false,
    'customers.see_invoice_history': false,
    'materials.view': true,
    'materials.see_pricing': false,
    'invoices.view': false,
    'reports.jobs': true,
    'settings.email_signature.own': true,
    'portal_tiers.manage': false,
  },
  digital: {
    'dashboard.overview': true,
    'dashboard.job_queue': true,
    'dashboard.metrics.own': true,
    'quotes.view': false,
    'quotes.see_pricing': false,
    'jobs.view': true,
    'jobs.move_stages': true,
    'jobs.proofs': true,
    'jobs.see_pricing': false,
    'jobs.flag': true,
    'jobs.time_tracking': true,
    'customers.view': true,
    'customers.create': false,
    'customers.see_invoice_history': false,
    'materials.view': true,
    'materials.see_pricing': false,
    'invoices.view': false,
    'reports.jobs': true,
    'settings.email_signature.own': true,
    'portal_tiers.manage': false,
  },
  accounting: {
    'dashboard.overview': true,
    'dashboard.revenue': true,
    'dashboard.metrics.own': true,
    'quotes.view': true,
    'quotes.see_pricing': true,
    'quotes.create': false,
    'quotes.export_pdf': true,
    'sales_orders.view': true,
    'sales_orders.see_pricing': true,
    'shipping.view': true,
    'shipping.create': true,
    'jobs.view': false,
    'jobs.see_pricing': true,
    'customers.view': true,
    'customers.see_invoice_history': true,
    'materials.view': true,
    'materials.see_pricing': true,
    'materials.create': true,
    'materials.edit': true,
    'materials.edit_inventory': true,
    'purchase_orders.view': true,
    'purchase_orders.create': true,
    'purchase_orders.edit': true,
    'invoices.view': true,
    'invoices.create': true,
    'invoices.edit': true,
    'invoices.record_payment': true,
    'invoices.qb_export': true,
    'settings.labor_rates': true,
    'settings.machine_rates': true,
    'reports.quotes': true,
    'reports.sales_orders': true,
    'reports.financial': true,
    'reports.customers': true,
    'settings.email_signature.own': true,
    'settings.billing': false,
    'portal_tiers.manage': false,
  },
}

// Role+tier combination upgrades — more specific than TIER_UPGRADES (which
// applies to every role at a given tier, regardless of department) and less
// specific than a per-user override. Use this when a permission should only
// go to a *specific* role at a *specific* tier (e.g. sales managers, not
// every manager org-wide) — adding to TIER_UPGRADES instead would leak the
// grant to managers in unrelated departments.
export const ROLE_TIER_UPGRADES: Partial<Record<Role, Partial<Record<Tier, Record<string, boolean>>>>> = {
  sales: {
    manager: {
      'portal_tiers.manage': true,
    },
  },
  accounting: {
    manager: {
      'portal_tiers.manage': true,
    },
  },
}

export const TIER_UPGRADES: Record<Tier, Record<string, boolean>> = {
  staff: {},
  lead: {
    'jobs.view_dept_all': true,
    'jobs.reassign_dept': true,
    'jobs.assign_department': true,
    'dashboard.dept_metrics': true,
    'dashboard.customize': true,
  },
  manager: {
    'jobs.view_dept_all': true,
    'jobs.view_cross_dept': true,
    'jobs.reassign_dept': true,
    'jobs.assign_department': true,
    'quotes.discount_override': true,
    'dashboard.dept_metrics': true,
    'dashboard.all_metrics': true,
    'reports.jobs': true,
    'permission_overrides.grant': true,
    'dashboard.customize': true,
  },
}

export function hasPermission(
  profile: { role: Role; tier: Tier },
  overrides: { permission_key: string; granted: boolean }[],
  permission: string,
): boolean {
  // Owner always has access
  if (profile.role === 'owner') return true

  // Check manual overrides first (granted by Owner/Manager)
  const override = overrides.find((o) => o.permission_key === permission)
  if (override !== undefined) return override.granted

  // Check role+tier combination upgrades — more specific than tier alone
  const roleTierUpgrade = ROLE_TIER_UPGRADES[profile.role]?.[profile.tier]?.[permission]
  if (roleTierUpgrade !== undefined) return roleTierUpgrade

  // Check tier upgrades
  const tierUpgrade = TIER_UPGRADES[profile.tier]?.[permission]
  if (tierUpgrade !== undefined) return tierUpgrade

  // Fall back to role defaults
  const roleDefaults = ROLE_DEFAULTS[profile.role]
  if (roleDefaults['*']) return true
  return roleDefaults[permission] ?? false
}

// Server-side helper to load a user's profile + overrides from Supabase
// and resolve a permission. Used in server components and server actions.
export type UserProfile = {
  role: Role
  tier: Tier
  departments: string[]
  organization_id: string | null
}
