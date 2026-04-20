'use client'

import { useState, useRef, useTransition } from 'react'
import { inviteMember } from './actions'
import type { OrgRole } from '@/types/database'

type Props = {
  orgId: string
  orgSlug: string
}

const ROLE_OPTIONS: { value: OrgRole; label: string; description: string }[] = [
  { value: 'admin', label: 'Admin', description: 'Can manage members, jobs, quotes, and customers' },
  { value: 'designer', label: 'Designer', description: 'Assigned to jobs for design work with a focused queue view' },
  { value: 'accountant', label: 'Accountant', description: 'Views invoicing, aging buckets, and completed jobs for billing' },
  { value: 'member', label: 'Member', description: 'Can create and edit jobs, quotes, and customers' },
  { value: 'viewer', label: 'Viewer', description: 'Can view everything but cannot make changes' },
]

export default function InviteMemberForm({ orgId, orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      }
    })
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null) }}
        className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-fuchsia focus:ring-offset-2"
      >
        Invite Member
      </button>

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
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email address <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  maxLength={200}
                  placeholder="colleague@example.com"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
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
                        defaultChecked={option.value === 'member'}
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
