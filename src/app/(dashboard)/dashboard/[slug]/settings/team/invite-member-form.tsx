'use client'

import { useState, useRef, useTransition } from 'react'
import { inviteMember } from './actions'
import { TIER_LABELS, type Role, type Tier } from '@/lib/permissions'

type Props = {
  orgId: string
  orgSlug: string
}

// These are profiles.role values -- the vocabulary hasPermission() actually
// evaluates (permissions.ts). This list used to hold OrgRole values
// ('admin'/'member'/'viewer'/'accountant'), which are a different enum
// entirely: they cannot satisfy the profiles.role CHECK constraint, and two
// of them weren't even valid org_role values. See the header comment in
// actions.ts for the full account of the two vocabularies.
//
// 'owner' is not offered -- see INVITABLE_ROLES in actions.ts.
const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: 'sales',      label: 'Sales',      description: 'Quotes, customers, and sales orders' },
  { value: 'designer',   label: 'Designer',   description: 'Assigned to jobs for design work with a focused queue view' },
  { value: 'production', label: 'Production', description: 'The production floor — jobs, proofs, and the job board' },
  { value: 'installer',  label: 'Installer',  description: 'Installation scheduling and job completion' },
  { value: 'digital',    label: 'Digital',    description: 'Digital marketing and screens' },
  { value: 'accounting', label: 'Accounting', description: 'Invoicing, payments, aging, and QuickBooks export' },
]

// Matches the profiles.role DB default (migration 011:10) and is the most
// common role in the org. The previous preselection was 'member', which is
// not a valid profiles.role value at all -- left as-is it would preselect
// nothing now that this list holds real roles.
const DEFAULT_ROLE: Role = 'production'

// profiles.tier -- a separate axis that upgrades a role's permissions
// (TIER_UPGRADES in permissions.ts). 'staff' matches the DB default and is
// preselected, but it is an explicit choice rather than a silent one.
const TIER_OPTIONS: { value: Tier; description: string }[] = [
  { value: 'staff',   description: 'Standard access for the role' },
  { value: 'lead',    description: 'Adds some oversight within the role' },
  { value: 'manager', description: 'Adds reporting and team oversight' },
]

export default function InviteMemberForm({ orgId, orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await inviteMember(orgId, orgSlug, formData)
      if (result.error) {
        setError(result.error)
      } else {
        formRef.current?.reset()
        setOpen(false)
        // The account now exists; say so rather than leaving the admin to
        // guess from a dialog that just closed. Previously this button
        // produced no account and no email, so "sent" would have been a lie.
        setSent(result.email ?? null)
      }
    })
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {sent && (
          <span className="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 border border-green-200">
            Account created — {sent} can set a password from the email.
          </span>
        )}
        <button
          onClick={() => { setOpen(true); setError(null); setSent(null) }}
          className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-fuchsia focus:ring-offset-2"
        >
          Invite Member
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !isPending && setOpen(false)}
          />

          {/* Dialog */}
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Invite Member</h2>
            <p className="mt-1 text-sm text-gray-500">
              Send an invitation to join this organization.
            </p>

            {error && (
              <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {error}
              </div>
            )}

            <form ref={formRef} action={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                  Full name <span className="text-red-500">*</span>
                </label>
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  required
                  autoFocus
                  maxLength={120}
                  placeholder="Jane Doe"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email address <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={200}
                  placeholder="colleague@example.com"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              <div>
                <label htmlFor="tier" className="block text-sm font-medium text-gray-700">
                  Level <span className="text-red-500">*</span>
                </label>
                <select
                  id="tier"
                  name="tier"
                  required
                  defaultValue="staff"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                >
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {TIER_LABELS[t.value]} — {t.description}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Departments are assigned after the account is created, from the member list.
                </p>
              </div>

              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                  Role <span className="text-red-500">*</span>
                </label>
                <div className="mt-2 space-y-2">
                  {ROLE_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50 has-[:checked]:border-qm-lime has-[:checked]:bg-qm-lime-light"
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        required
                        defaultChecked={option.value === DEFAULT_ROLE}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">{option.label}</span>
                        <p className="text-xs text-gray-500">{option.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {isPending ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
