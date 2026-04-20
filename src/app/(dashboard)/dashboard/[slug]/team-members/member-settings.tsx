'use client'

import { useEffect, useState, useTransition } from 'react'
import { updateMemberProfile, getPermissionOverrides, setPermissionOverride, removePermissionOverride } from './actions'
import type { PermissionOverride } from './actions'
import { ALL_ROLES, ALL_TIERS, ROLE_LABELS, TIER_LABELS, ROLE_DEFAULTS } from '@/lib/permissions'
import type { Role, Tier } from '@/lib/permissions'

// Toggleable permission keys shown in the overrides panel
const OVERRIDE_KEYS = [
  { key: 'quotes.view', label: 'View Quotes' },
  { key: 'quotes.see_pricing', label: 'See Quote Pricing' },
  { key: 'quotes.discount_override', label: 'Override Discounts' },
  { key: 'quotes.delete', label: 'Delete Quotes' },
  { key: 'invoices.view', label: 'View Invoices' },
  { key: 'invoices.create', label: 'Create Invoices' },
  { key: 'invoices.record_payment', label: 'Record Payments' },
  { key: 'customers.delete', label: 'Delete Customers' },
  { key: 'customers.see_invoice_history', label: 'See Invoice History' },
  { key: 'materials.see_pricing', label: 'See Material Pricing' },
  { key: 'reports.financial', label: 'Financial Reports' },
  { key: 'settings.email_templates', label: 'Email Templates' },
  { key: 'settings.labor_rates', label: 'Labor Rates' },
  { key: 'settings.machine_rates', label: 'Machine Rates' },
  { key: 'settings.team_members.manage', label: 'Manage Team Members' },
  { key: 'jobs.see_pricing', label: 'See Job Pricing' },
]

type Department = { id: string; name: string; code: string }

type Props = {
  userId: string
  orgId: string
  orgSlug: string
  currentRole: Role
  currentTier: Tier
  currentDepartments: string[]
  currentTitle: string
  currentPhone: string
  departments: Department[]
  canEditRole: boolean   // only owner
  canEditDepts: boolean  // owner or manager
  memberName: string
}

export default function MemberSettings({
  userId, orgId, orgSlug,
  currentRole, currentTier, currentDepartments,
  currentTitle, currentPhone,
  departments, canEditRole, canEditDepts, memberName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>(currentRole)
  const [tier, setTier] = useState<Tier>(currentTier)
  const [depts, setDepts] = useState<string[]>(currentDepartments)
  const [title, setTitle] = useState(currentTitle)
  const [phone, setPhone] = useState(currentPhone)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showOverrides, setShowOverrides] = useState(false)
  const [overrides, setOverrides] = useState<PermissionOverride[]>([])
  const [loadingOverrides, setLoadingOverrides] = useState(false)

  // Load overrides when panel is expanded
  useEffect(() => {
    if (!showOverrides || overrides.length > 0 || loadingOverrides) return
    setLoadingOverrides(true)
    getPermissionOverrides(userId, orgId).then(({ overrides: loaded }) => {
      setOverrides(loaded)
      setLoadingOverrides(false)
    })
  }, [showOverrides, userId, orgId, overrides.length, loadingOverrides])

  async function handleToggleOverride(key: string) {
    const existing = overrides.find((o) => o.permission_key === key)
    if (existing) {
      // Toggle: if currently granted, flip to denied, and vice versa
      // If it matches the role default, remove the override entirely
      const roleDefault = ROLE_DEFAULTS[role]?.[key] ?? false
      const newGranted = !existing.granted
      if (newGranted === roleDefault) {
        // Remove override — it matches default
        const res = await removePermissionOverride(userId, orgId, orgSlug, key)
        if (!res.error) {
          setOverrides((prev) => prev.filter((o) => o.permission_key !== key))
        }
      } else {
        const res = await setPermissionOverride(userId, orgId, orgSlug, key, newGranted)
        if (!res.error) {
          setOverrides((prev) => prev.map((o) =>
            o.permission_key === key ? { ...o, granted: newGranted } : o,
          ))
        }
      }
    } else {
      // No override exists — create one that flips the default
      const roleDefault = ROLE_DEFAULTS[role]?.[key] ?? false
      const res = await setPermissionOverride(userId, orgId, orgSlug, key, !roleDefault)
      if (!res.error) {
        setOverrides((prev) => [...prev, { id: '', permission_key: key, granted: !roleDefault, note: null }])
      }
    }
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateMemberProfile(userId, orgId, orgSlug, {
        role: canEditRole ? role : undefined,
        tier: canEditRole ? tier : undefined,
        departments: canEditDepts ? depts : undefined,
        title,
        phone,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setOpen(false)
      }
    })
  }

  function toggleDept(code: string) {
    setDepts((prev) =>
      prev.includes(code) ? prev.filter((d) => d !== code) : [...prev, code],
    )
  }

  if (!canEditRole && !canEditDepts) return null

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null) }}
        className="rounded p-1 text-gray-400 hover:text-gray-600"
        title="Edit member"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && setOpen(false)} />
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Edit {memberName}</h2>

            {error && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <div className="mt-4 space-y-4">
              {/* Role */}
              {canEditRole && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Tier */}
              {canEditRole && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Tier</label>
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value as Tier)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                  >
                    {ALL_TIERS.map((t) => (
                      <option key={t} value={t}>{TIER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Departments */}
              {canEditDepts && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Departments</label>
                  <div className="grid grid-cols-2 gap-2">
                    {departments.map((dept) => (
                      <label
                        key={dept.id}
                        className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 has-[:checked]:border-qm-lime has-[:checked]:bg-qm-lime-light"
                      >
                        <input
                          type="checkbox"
                          checked={depts.includes(dept.code)}
                          onChange={() => toggleDept(dept.code)}
                          className="h-4 w-4 rounded border-gray-300 accent-qm-lime"
                        />
                        {dept.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. President, Lead Designer"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              {/* Permission Overrides — expandable */}
              {(canEditRole || canEditDepts) && role !== 'owner' && (
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowOverrides((p) => !p)}
                    className="flex w-full items-center justify-between text-sm font-medium text-gray-700"
                  >
                    <span>Permission Overrides</span>
                    <svg
                      className={`h-4 w-4 text-gray-400 transition-transform ${showOverrides ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <p className="mt-1 text-xs text-gray-400">
                    Grant or revoke individual permissions on top of the role defaults.
                  </p>

                  {showOverrides && (
                    <div className="mt-3 space-y-1">
                      {loadingOverrides ? (
                        <p className="text-xs text-gray-400">Loading...</p>
                      ) : (
                        OVERRIDE_KEYS.map(({ key, label }) => {
                          const roleDefault = ROLE_DEFAULTS[role]?.[key] ?? false
                          const override = overrides.find((o) => o.permission_key === key)
                          const effective = override !== undefined ? override.granted : roleDefault
                          const isOverridden = override !== undefined

                          return (
                            <label
                              key={key}
                              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                                isOverridden ? 'bg-amber-50 border border-amber-200' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={effective}
                                  onChange={() => handleToggleOverride(key)}
                                  className="h-4 w-4 rounded border-gray-300 accent-qm-lime"
                                />
                                <span className={isOverridden ? 'font-medium' : ''}>{label}</span>
                              </div>
                              {isOverridden && (
                                <span className="text-xs text-amber-600 font-medium">override</span>
                              )}
                            </label>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
