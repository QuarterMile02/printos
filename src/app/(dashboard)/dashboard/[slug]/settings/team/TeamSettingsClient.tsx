'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import InviteMemberForm from './invite-member-form';
import { STAFF_DEPARTMENTS } from '@/lib/staff-departments';
import PhoneInput from '@/components/ui/PhoneInput';

type Role = 'owner' | 'sales' | 'designer' | 'production' | 'installer' | 'digital' | 'accounting';
type Tier = 'staff' | 'lead' | 'manager';
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

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner', sales: 'Sales', designer: 'Designer',
  production: 'Production', installer: 'Installer', digital: 'Digital', accounting: 'Accounting',
};

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner', admin: 'Admin', designer: 'Designer',
  accountant: 'Accountant', member: 'Member', viewer: 'Viewer',
};

const TIER_LABELS: Record<Tier, string> = { staff: 'Staff', lead: 'Lead', manager: 'Manager' };

const INVITE_STATUS_STYLES: Record<InviteStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  accepted: 'bg-green-50 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DEPARTMENTS = STAFF_DEPARTMENTS;

type PermissionKey =
  | 'see_pricing' | 'apply_discount' | 'approve_exception'
  | 'invoices.edit' | 'invoices.void'
  | 'payments.record' | 'payments.refund'
  | 'jobs.reassign' | 'jobs.delete'
  | 'customers.delete' | 'reports.view_financial' | 'settings.edit'
  | 'rates.edit_labor' | 'rates.edit_machine';

interface PermissionDef {
  key: PermissionKey;
  label: string;
  pricingRelated?: boolean;
}

const PERMISSION_GROUPS: { title: string; permissions: PermissionDef[] }[] = [
  {
    title: 'Pricing',
    permissions: [
      { key: 'see_pricing', label: 'See pricing & costs', pricingRelated: true },
      { key: 'apply_discount', label: 'Apply discounts', pricingRelated: true },
      { key: 'approve_exception', label: 'Approve pricing exceptions', pricingRelated: true },
    ],
  },
  {
    title: 'Invoices',
    permissions: [
      { key: 'invoices.edit', label: 'Create & edit invoices' },
      { key: 'invoices.void', label: 'Void invoices' },
    ],
  },
  {
    title: 'Payments',
    permissions: [
      { key: 'payments.record', label: 'Record payments' },
      { key: 'payments.refund', label: 'Issue refunds' },
    ],
  },
  {
    title: 'Jobs',
    permissions: [
      { key: 'jobs.reassign', label: 'Reassign jobs' },
      { key: 'jobs.delete', label: 'Delete jobs' },
    ],
  },
  {
    title: 'Admin',
    permissions: [
      { key: 'customers.delete', label: 'Delete customers' },
      { key: 'reports.view_financial', label: 'View financial reports' },
      { key: 'settings.edit', label: 'Edit organization settings' },
      { key: 'rates.edit_labor', label: 'Edit labor rates' },
      { key: 'rates.edit_machine', label: 'Edit machine rates' },
    ],
  },
];

const ROLE_PERMISSION_DEFAULTS: Record<Role, Record<PermissionKey, boolean>> = {
  owner: {
    see_pricing: true, apply_discount: true, approve_exception: true,
    'invoices.edit': true, 'invoices.void': true,
    'payments.record': true, 'payments.refund': true,
    'jobs.reassign': true, 'jobs.delete': true,
    'customers.delete': true, 'reports.view_financial': true, 'settings.edit': true,
    'rates.edit_labor': true, 'rates.edit_machine': true,
  },
  sales: {
    see_pricing: true, apply_discount: true, approve_exception: false,
    'invoices.edit': true, 'invoices.void': false,
    'payments.record': true, 'payments.refund': false,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': true, 'settings.edit': false,
    'rates.edit_labor': false, 'rates.edit_machine': false,
  },
  accounting: {
    see_pricing: true, apply_discount: false, approve_exception: false,
    'invoices.edit': true, 'invoices.void': true,
    'payments.record': true, 'payments.refund': true,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': true, 'settings.edit': false,
    'rates.edit_labor': true, 'rates.edit_machine': true,
  },
  designer: {
    see_pricing: false, apply_discount: false, approve_exception: false,
    'invoices.edit': false, 'invoices.void': false,
    'payments.record': false, 'payments.refund': false,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': false, 'settings.edit': false,
    'rates.edit_labor': false, 'rates.edit_machine': false,
  },
  production: {
    see_pricing: false, apply_discount: false, approve_exception: false,
    'invoices.edit': false, 'invoices.void': false,
    'payments.record': false, 'payments.refund': false,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': false, 'settings.edit': false,
    'rates.edit_labor': false, 'rates.edit_machine': false,
  },
  installer: {
    see_pricing: false, apply_discount: false, approve_exception: false,
    'invoices.edit': false, 'invoices.void': false,
    'payments.record': false, 'payments.refund': false,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': false, 'settings.edit': false,
    'rates.edit_labor': false, 'rates.edit_machine': false,
  },
  digital: {
    see_pricing: false, apply_discount: false, approve_exception: false,
    'invoices.edit': false, 'invoices.void': false,
    'payments.record': false, 'payments.refund': false,
    'jobs.reassign': false, 'jobs.delete': false,
    'customers.delete': false, 'reports.view_financial': false, 'settings.edit': false,
    'rates.edit_labor': false, 'rates.edit_machine': false,
  },
};

const PRICING_ROLES: Role[] = ['owner', 'sales', 'accounting'];

type StatusTab = 'all' | 'enabled' | 'disabled';

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
    const res = await fetch('/api/settings/team');
    const data = await res.json();
    setMembers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchMembers(); }, []);

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
                        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                          {group.permissions.map(perm => {
                            const roleDefault =
                              ROLE_PERMISSION_DEFAULTS[selected.role]?.[perm.key] ?? false;
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
                                  <p className="text-sm text-gray-700">{perm.label}</p>
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
