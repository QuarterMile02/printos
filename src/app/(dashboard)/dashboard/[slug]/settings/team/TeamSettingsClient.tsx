'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import InviteMemberForm from './invite-member-form';
import { STAFF_DEPARTMENTS } from '@/lib/staff-departments';
import PhoneInput from '@/components/ui/PhoneInput';
import {
  ROLE_LABELS,
  TIER_LABELS,
  hasPermission,
  type Role,
  type Tier,
} from '@/lib/permissions';

type OrgRole = 'owner' | 'admin' | 'designer' | 'accountant' | 'member' | 'viewer';
type InviteStatus = 'pending' | 'accepted' | 'expired';

interface TeamMember {
  id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  role: Role;
  tier: Tier;
  departments: string[] | null;
  is_active: boolean;
  email: string | null;
  org_role: OrgRole | null;
  joined_at: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  role: OrgRole;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
}

interface PermissionOverride {
  id: string;
  permission_key: string;
  granted: boolean;
}

interface Props {
  slug: string;
  orgId: string;
  orgSlug: string;
  currentUserId: string;
  currentUserRole: string;
  currentUserTier: string;
  canInvite: boolean;
  pendingInvites: PendingInvite[];
}

const ROLES: Role[] = ['owner', 'sales', 'designer', 'production', 'installer', 'digital', 'accounting'];
const TIERS: Tier[] = ['staff', 'lead', 'manager'];

// ROLE_LABELS, TIER_LABELS now imported from '@/lib/permissions' — the
// real source of truth — instead of a second hardcoded copy here.

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Admin', designer: 'Designer',
  accountant: 'Accountant', member: 'Member', viewer: 'Viewer',
};

const INVITE_STATUS_STYLES: Record<InviteStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-green-50 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DEPARTMENTS = STAFF_DEPARTMENTS;

interface PermissionDef {
  key: string;
  label: string;
  pricingRelated?: boolean;
}

// Every permission key actually referenced by a checkPermission()/
// hasPermission() call site anywhere in the codebase, confirmed by
// grepping every call site directly (2026-08-19 investigation, redone
// after migration 149 recreated permission_overrides). Keys NOT in this
// set are defined in ROLE_DEFAULTS/TIER_UPGRADES but nothing currently
// reads them -- toggling them has no real effect on access yet. Shown
// with a "Not yet enforced" badge below so nobody mistakes a dormant
// key for a working toggle. Update this set if a dormant key gets wired
// up, or a route gating one of these gets removed.
const ENFORCED_KEYS = new Set<string>([
  'customers.create', 'customers.edit',
  'dashboard.customize',
  'invoices.view',
  'jobs.assign_department', 'jobs.print_label',
  'materials.edit_inventory',
  'portal_tiers.manage',
  'purchase_orders.view',
  'quotes.create', 'quotes.export_pdf', 'quotes.see_pricing',
  'reports.quotes',
  'sales_orders.see_pricing',
  'settings.labor_rates', 'settings.machine_rates',
  'settings.material_categories', 'settings.material_types',
  'settings.product_categories', 'settings.product_types',
  'settings.promo_codes', 'settings.shipping_methods', 'settings.shipping_profiles',
  'settings.custom_notes', 'settings.general_categories',
  'shipping.create', 'shipping.view',
]);

// Grouped by real app area (not the old 5 arbitrary categories) — every
// key defined anywhere in ROLE_DEFAULTS/TIER_UPGRADES/ROLE_TIER_UPGRADES
// in src/lib/permissions.ts, 75 total. `note` on a group with an empty
// permissions array documents an area with genuinely no permission key
// yet, rather than silently omitting it.
const PERMISSION_GROUPS: { title: string; note?: string; permissions: PermissionDef[] }[] = [
  {
    title: 'Customers',
    permissions: [
      { key: 'customers.view', label: 'View customers' },
      { key: 'customers.create', label: 'Create customers' },
      { key: 'customers.edit', label: 'Edit customers' },
      { key: 'customers.delete', label: 'Delete customers' },
      { key: 'customers.see_invoice_history', label: 'See invoice history', pricingRelated: true },
    ],
  },
  {
    title: 'Quotes',
    permissions: [
      { key: 'quotes.view', label: 'View quotes' },
      { key: 'quotes.create', label: 'Create quotes' },
      { key: 'quotes.edit', label: 'Edit quotes' },
      { key: 'quotes.see_pricing', label: 'See quote pricing', pricingRelated: true },
      { key: 'quotes.discount_override', label: 'Override discount limits', pricingRelated: true },
      { key: 'quotes.send', label: 'Send quotes' },
      { key: 'quotes.convert', label: 'Convert quote to sales order' },
      { key: 'quotes.delete', label: 'Delete quotes' },
      { key: 'quotes.export_pdf', label: 'Export quote PDF' },
    ],
  },
  {
    title: 'Sales Orders',
    permissions: [
      { key: 'sales_orders.view', label: 'View sales orders' },
      { key: 'sales_orders.edit', label: 'Edit sales orders' },
      { key: 'sales_orders.see_pricing', label: 'See sales order pricing', pricingRelated: true },
    ],
  },
  {
    title: 'Invoices',
    permissions: [
      { key: 'invoices.view', label: 'View invoices' },
      { key: 'invoices.create', label: 'Create invoices' },
      { key: 'invoices.edit', label: 'Edit invoices' },
      { key: 'invoices.record_payment', label: 'Record invoice payments', pricingRelated: true },
      { key: 'invoices.qb_export', label: 'Export to QuickBooks' },
    ],
  },
  {
    title: 'Payments',
    note: 'No permission key exists for this area yet — payments has no access control anywhere in the app.',
    permissions: [],
  },
  {
    title: 'Jobs',
    permissions: [
      { key: 'jobs.view', label: 'View jobs' },
      { key: 'jobs.move_stages', label: 'Move jobs between stages' },
      { key: 'jobs.print_label', label: 'Print job labels' },
      { key: 'jobs.proofs', label: 'Manage proofs' },
      { key: 'jobs.see_pricing', label: 'See job pricing', pricingRelated: true },
      { key: 'jobs.flag', label: 'Flag jobs' },
      { key: 'jobs.time_tracking', label: 'Track time on jobs' },
      { key: 'jobs.assign_department', label: 'Assign job department' },
      { key: 'jobs.reassign_dept', label: 'Reassign job department' },
      { key: 'jobs.view_dept_all', label: 'View all department jobs' },
      { key: 'jobs.view_cross_dept', label: 'View cross-department jobs' },
    ],
  },
  {
    title: 'Purchase Orders',
    permissions: [
      { key: 'purchase_orders.view', label: 'View purchase orders' },
      { key: 'purchase_orders.create', label: 'Create purchase orders' },
      { key: 'purchase_orders.edit', label: 'Edit purchase orders' },
    ],
  },
  {
    title: 'Shipping',
    permissions: [
      { key: 'shipping.view', label: 'View shipments' },
      { key: 'shipping.create', label: 'Create shipments' },
    ],
  },
  {
    title: 'Materials',
    permissions: [
      { key: 'materials.view', label: 'View materials' },
      { key: 'materials.see_pricing', label: 'See material pricing', pricingRelated: true },
      { key: 'materials.edit_inventory', label: 'Edit material inventory' },
      { key: 'materials.create', label: 'Create materials' },
      { key: 'materials.edit', label: 'Edit materials' },
    ],
  },
  {
    title: 'Reports',
    permissions: [
      { key: 'reports.quotes', label: 'Run quote reports' },
      { key: 'reports.sales_orders', label: 'Run sales order reports' },
      { key: 'reports.jobs', label: 'Run job reports' },
      { key: 'reports.customers', label: 'Run customer reports' },
      { key: 'reports.financial', label: 'Run financial reports', pricingRelated: true },
    ],
  },
  {
    title: 'Dashboard',
    permissions: [
      { key: 'dashboard.overview', label: 'View dashboard overview' },
      { key: 'dashboard.revenue', label: 'View revenue widgets', pricingRelated: true },
      { key: 'dashboard.job_queue', label: 'View job queue widget' },
      { key: 'dashboard.metrics.own', label: 'View own metrics' },
      { key: 'dashboard.metrics.all', label: 'View all metrics' },
      { key: 'dashboard.dept_metrics', label: 'View department metrics' },
      { key: 'dashboard.all_metrics', label: 'View all-org metrics' },
      { key: 'dashboard.customize', label: 'Customize dashboard layout' },
    ],
  },
  {
    title: 'Portal Tiers',
    permissions: [
      { key: 'portal_tiers.manage', label: 'Manage portal tiers & discounts' },
    ],
  },
  {
    title: 'Settings',
    permissions: [
      { key: 'settings.email_templates', label: 'Edit email templates' },
      { key: 'settings.team_members.view', label: 'View team members' },
      { key: 'settings.team_members.manage', label: 'Manage team members' },
      { key: 'settings.email_signature.own', label: 'Edit own email signature' },
      { key: 'settings.labor_rates', label: 'Edit labor rates', pricingRelated: true },
      { key: 'settings.machine_rates', label: 'Edit machine rates', pricingRelated: true },
      { key: 'settings.billing', label: 'Manage billing', pricingRelated: true },
      { key: 'settings.material_categories', label: 'Manage material categories' },
      { key: 'settings.material_types', label: 'Manage material types' },
      { key: 'settings.product_categories', label: 'Manage product categories' },
      { key: 'settings.product_types', label: 'Manage product types' },
      { key: 'settings.promo_codes', label: 'Manage promo codes', pricingRelated: true },
      { key: 'settings.shipping_methods', label: 'Manage shipping methods' },
      { key: 'settings.shipping_profiles', label: 'Manage shipping profiles' },
      { key: 'settings.custom_notes', label: 'Manage custom notes' },
      { key: 'settings.general_categories', label: 'Manage general categories' },
      { key: 'permission_overrides.grant', label: 'Grant permission overrides' },
      { key: 'pricing_formulas.edit', label: 'Edit pricing formulas', pricingRelated: true },
    ],
  },
];

const PRICING_ROLES: Role[] = ['owner', 'sales', 'accounting'];

type StatusTab = 'all' | 'enabled' | 'disabled';

// Plain fetch, no setState -- shared by the mount effect and the
// post-save refresh so the actual request/parsing logic isn't
// duplicated between them.
async function fetchTeamMembers(): Promise<TeamMember[]> {
  const res = await fetch('/api/settings/team');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default function TeamSettingsClient({
  orgId, orgSlug, currentUserId, currentUserRole, currentUserTier, canInvite, pendingInvites,
}: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'permissions'>('profile');
  const [statusTab, setStatusTab] = useState<StatusTab>('enabled');
  const [overrides, setOverrides] = useState<PermissionOverride[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editRole, setEditRole] = useState<Role>('sales');
  const [editTier, setEditTier] = useState<Tier>('staff');
  const [editDepts, setEditDepts] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);

  const isOwner = currentUserRole === 'owner';
  const canManagePerms = isOwner || currentUserTier === 'manager' || currentUserTier === 'lead';

  const fetchMembers = async () => {
    setMembers(await fetchTeamMembers());
    setLoading(false);
  };

  // Initial fetch on mount. Deliberately not just `useEffect(() => {
  // fetchMembers() }, [])` -- fetchMembers's setState calls happen
  // after an await (never synchronously), but the react-hooks lint
  // rule's static analysis can't see that far and flags any effect
  // that transitively calls a named, component-level function which
  // itself calls setState. React's own recommended shape for a
  // data-fetching effect is to inline the async work directly in the
  // effect with a cleanup-based `ignore` flag, which also genuinely
  // guards against a slow response landing after a faster re-run
  // (https://react.dev/learn/you-might-not-need-an-effect#fetching-data)
  useEffect(() => {
    let ignore = false;
    (async () => {
      const list = await fetchTeamMembers();
      if (!ignore) {
        setMembers(list);
        setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, []);

  const tabCounts = useMemo(() => ({
    all: members.length,
    enabled: members.filter(m => m.is_active).length,
    disabled: members.filter(m => !m.is_active).length,
  }), [members]);

  const visibleMembers = useMemo(() => {
    if (statusTab === 'all') return members;
    if (statusTab === 'enabled') return members.filter(m => m.is_active);
    return members.filter(m => !m.is_active);
  }, [members, statusTab]);

  const openMember = useCallback((m: TeamMember) => {
    setSelected(m);
    setActiveTab('profile');
    setEditTitle(m.title ?? '');
    setEditPhone(m.phone ?? '');
    setEditMobile(m.mobile ?? '');
    setEditRole(m.role);
    setEditTier(m.tier);
    setEditDepts(m.departments ?? []);
    setEditActive(m.is_active);
    setError(null);
    setOverrides([]);
  }, []);

  const loadOverrides = useCallback(async (memberId: string) => {
    setOverridesLoading(true);
    const res = await fetch(`/api/settings/team/${memberId}/permissions`);
    const data = await res.json();
    setOverrides(Array.isArray(data) ? data : []);
    setOverridesLoading(false);
  }, []);

  const handleTabChange = (tab: 'profile' | 'permissions') => {
    setActiveTab(tab);
    if (tab === 'permissions' && selected) loadOverrides(selected.id);
  };

  const saveProfile = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: editTitle,
      phone: editPhone,
      mobile: editMobile,
      departments: editDepts,
      is_active: editActive,
    };
    if (isOwner) {
      body.role = editRole;
      body.tier = editTier;
    }
    const res = await fetch(`/api/settings/team/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Save failed');
    } else {
      await fetchMembers();
      setSelected(prev =>
        prev
          ? {
              ...prev,
              title: editTitle || null,
              phone: editPhone || null,
              mobile: editMobile || null,
              role: editRole,
              tier: editTier,
              departments: editDepts,
              is_active: editActive,
            }
          : null
      );
    }
  };

  const toggleDept = (val: string) => {
    setEditDepts(prev => (prev.includes(val) ? prev.filter(d => d !== val) : [...prev, val]));
  };

  const setOverrideFn = async (permKey: string, granted: boolean) => {
    if (!selected) return;
    const res = await fetch(`/api/settings/team/${selected.id}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_key: permKey, granted }),
    });
    if (res.ok) {
      setOverrides(prev => {
        const existing = prev.find(o => o.permission_key === permKey);
        if (existing) return prev.map(o => (o.permission_key === permKey ? { ...o, granted } : o));
        return [...prev, { id: String(Date.now()), permission_key: permKey, granted }];
      });
    } else {
      const d = await res.json();
      setError(d.error ?? 'Failed to set override');
    }
  };

  const removeOverrideFn = async (permKey: string) => {
    if (!selected) return;
    const res = await fetch(`/api/settings/team/${selected.id}/permissions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_key: permKey }),
    });
    if (res.ok) {
      setOverrides(prev => prev.filter(o => o.permission_key !== permKey));
    } else {
      const d = await res.json();
      setError(d.error ?? 'Failed to remove override');
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Main table */}
      <div className="flex-1 min-w-0 p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">Team Members</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage roles, tiers, departments, and permission overrides.
            </p>
          </div>
          {canInvite && <InviteMemberForm orgId={orgId} orgSlug={orgSlug} />}
        </div>

        {pendingInvites.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">
              Pending Invites <span className="font-normal text-gray-400">({pendingInvites.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Email</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Role</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Invited</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingInvites.map((invite) => (
                    <tr key={invite.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-900">{invite.email}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                          {invite.role}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${INVITE_STATUS_STYLES[invite.status]}`}>
                          {invite.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">{formatDate(invite.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">{formatDate(invite.expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Status tabs */}
        <div className="mb-4 flex items-center gap-2">
          {(['all', 'enabled', 'disabled'] as StatusTab[]).map(t => (
            <button
              key={t}
              onClick={() => setStatusTab(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusTab === t
                  ? 'bg-qm-lime-light text-qm-lime'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t === 'all' ? 'All' : t === 'enabled' ? 'Enabled' : 'Disabled'}
              <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[t]})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading team...</div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Title</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Joined</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleMembers.map(m => (
                  <tr
                    key={m.id}
                    onClick={() => openMember(m)}
                    className={`cursor-pointer transition-colors ${
                      selected?.id === m.id ? 'bg-qm-lime-light' : 'hover:bg-gray-50'
                    } ${!m.is_active ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600 shrink-0">
                          {m.full_name.charAt(0).toUpperCase()}
                        </span>
                        {m.full_name}
                        {m.id === currentUserId && (
                          <span className="text-xs text-gray-400">(you)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.email ?? <span className="text-gray-300">&mdash;</span>}</td>
                    <td className="px-4 py-3 text-gray-500">{m.title ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{m.tier}</td>
                    <td className="px-4 py-3 text-gray-500">{m.joined_at ? formatDate(m.joined_at) : <span className="text-gray-300">&mdash;</span>}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
                {visibleMembers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                      No {statusTab === 'all' ? '' : statusTab} members.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-over */}
      {selected && (
        <div className="w-[480px] shrink-0 border-l border-gray-200 bg-white flex flex-col sticky top-0 h-screen overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <div>
              <p className="text-base font-bold text-gray-900">{selected.full_name}</p>
              <p className="text-xs text-gray-400">
                {ROLE_LABELS[selected.role] ?? selected.role} · {TIER_LABELS[selected.tier] ?? selected.tier}
                {selected.org_role && <> · <span title="Organization-level access role">{ORG_ROLE_LABELS[selected.org_role] ?? selected.org_role}</span></>}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 px-6 shrink-0">
            {(['profile', 'permissions'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`mr-4 py-3 text-sm font-semibold border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? 'border-qm-lime text-qm-lime'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4 shrink-0">✕</button>
              </div>
            )}

            {/* ── Profile Tab ── */}
            {activeTab === 'profile' && (
              <div className="px-6 py-5 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Full Name</label>
                  <p className="text-sm text-gray-800 font-medium">{selected.full_name}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
                  <p className="text-sm text-gray-600">{selected.email ?? '—'}</p>
                </div>

                {selected.org_role && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Organization Access Role</label>
                    <p className="text-sm text-gray-600">{ORG_ROLE_LABELS[selected.org_role] ?? selected.org_role}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Controls invite/admin permissions. Set when the member joined.</p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Title</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="e.g. Production Manager"
                    disabled={!canManagePerms}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Phone</label>
                  <PhoneInput
                    value={editPhone}
                    onChange={setEditPhone}
                    disabled={!canManagePerms}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Mobile</label>
                  <PhoneInput
                    value={editMobile}
                    onChange={setEditMobile}
                    disabled={!canManagePerms}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    Role{' '}
                    {!isOwner && <span className="font-normal text-gray-400">(owner only)</span>}
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as Role)}
                    disabled={!isOwner}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    Tier{' '}
                    {!isOwner && <span className="font-normal text-gray-400">(owner only)</span>}
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
                    value={editTier}
                    onChange={e => setEditTier(e.target.value as Tier)}
                    disabled={!isOwner}
                  >
                    {TIERS.map(t => (
                      <option key={t} value={t}>{TIER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-2">Departments</label>
                  <div className="grid grid-cols-3 gap-2">
                    {DEPARTMENTS.map(d => {
                      const checked = editDepts.includes(d.value);
                      return (
                        <label
                          key={d.value}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                            checked
                              ? 'border-qm-lime bg-qm-lime-light text-qm-lime'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          } ${!canManagePerms ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => { if (canManagePerms) toggleDept(d.value); }}
                            disabled={!canManagePerms}
                          />
                          {d.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Active</p>
                    <p className="text-xs text-gray-400">
                      Deactivate a departed employee instead of deleting them — their jobs, quotes, and activity history stay intact.
                    </p>
                  </div>
                  <button
                    onClick={() => { if (canManagePerms) setEditActive(prev => !prev); }}
                    disabled={!canManagePerms}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${
                      editActive ? 'bg-qm-lime' : 'bg-gray-300'
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        editActive ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {canManagePerms && (
                  <button
                    onClick={saveProfile}
                    disabled={saving}
                    className="w-full bg-qm-lime hover:brightness-110 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
            )}

            {/* ── Permissions Tab ── */}
            {activeTab === 'permissions' && (
              <div className="px-6 py-5">
                {overridesLoading ? (
                  <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
                ) : (
                  <div className="space-y-6">
                    <p className="text-xs text-gray-400">
                      Default permissions come from the member&apos;s role. Overrides always win.
                    </p>
                    {PERMISSION_GROUPS.map(group => (
                      <div key={group.title}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                          {group.title}
                        </p>
                        {group.note ? (
                          <p className="text-xs text-gray-400 italic px-1 pb-2">{group.note}</p>
                        ) : (
                        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                          {group.permissions.map(perm => {
                            // Mirrors the exact server-side resolution (hasPermission
                            // with no overrides applied) instead of a second hardcoded
                            // copy of role defaults — this badge can't drift from what
                            // checkPermission() actually computes.
                            const roleDefault = hasPermission(
                              { role: selected.role, tier: selected.tier },
                              [],
                              perm.key
                            );
                            const isEnforced = ENFORCED_KEYS.has(perm.key);
                            const override = overrides.find(o => o.permission_key === perm.key);
                            const isGrantedViaOverride = override?.granted === true;
                            const showPricingWarning =
                              perm.pricingRelated &&
                              !PRICING_ROLES.includes(selected.role) &&
                              isGrantedViaOverride;

                            return (
                              <div
                                key={perm.key}
                                className="flex items-center justify-between px-3 py-2.5 gap-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-sm text-gray-700">{perm.label}</p>
                                    {!isEnforced && (
                                      <span
                                        className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400"
                                        title="Defined in ROLE_DEFAULTS, but no route currently reads this permission key — toggling it has no effect yet."
                                      >
                                        Not yet enforced
                                      </span>
                                    )}
                                  </div>
                                  {showPricingWarning && (
                                    <p className="text-xs text-red-500 mt-0.5">
                                      Warning: pricing access granted to non-pricing role
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {/* Role default badge */}
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                      roleDefault
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {roleDefault ? '✓' : '✗'}
                                  </span>

                                  {/* Override badge or Grant/Deny buttons */}
                                  {override !== undefined ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                      {override.granted ? 'Granted' : 'Denied'}
                                      {canManagePerms && (
                                        <button
                                          onClick={() => removeOverrideFn(perm.key)}
                                          className="hover:text-amber-900 font-bold leading-none"
                                          title="Remove override"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </span>
                                  ) : canManagePerms ? (
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => setOverrideFn(perm.key, true)}
                                        className="rounded px-2 py-0.5 text-xs font-medium border border-gray-200 text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors"
                                      >
                                        Grant
                                      </button>
                                      <button
                                        onClick={() => setOverrideFn(perm.key, false)}
                                        className="rounded px-2 py-0.5 text-xs font-medium border border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
                                      >
                                        Deny
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
