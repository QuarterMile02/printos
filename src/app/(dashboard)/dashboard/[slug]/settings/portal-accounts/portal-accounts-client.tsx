'use client'

import { useState, useTransition } from 'react'
import { deletePortalLogin } from './actions'

export type Account = {
  portalUserId: string
  fullName: string
  email: string | null
  customers: { id: string; name: string }[]
  invitedAt: string | null
  lastLoginAt: string | null
}

type Props = {
  orgId: string
  orgSlug: string
  initialAccounts: Account[]
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalAccountsClient({ orgId, orgSlug, initialAccounts }: Props) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDelete(portalUserId: string) {
    setDeletingId(portalUserId)
    setError(null)
    setErrorId(null)
    startTransition(async () => {
      const res = await deletePortalLogin(portalUserId, orgId, orgSlug)
      setDeletingId(null)
      if (res.error) { setError(res.error); setErrorId(portalUserId); return }
      setAccounts((a) => a.filter((acc) => acc.portalUserId !== portalUserId))
      setConfirmingId(null)
    })
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No Customer Portal logins yet. Invite a contact from a customer&apos;s Contacts tab to create one.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
      {accounts.map((a) => (
        <div key={a.portalUserId} className="px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-gray-900">{a.fullName}</p>
              {a.email && <p className="text-sm text-gray-500">{a.email}</p>}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.customers.map((c) => (
                  <span key={c.id} className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                    {c.name}
                  </span>
                ))}
              </div>

              <p className="mt-2 text-xs text-gray-400">
                Invited {formatDate(a.invitedAt)} · Last login {formatDate(a.lastLoginAt)}
              </p>

              {errorId === a.portalUserId && error && (
                <p className="mt-2 text-xs text-red-600">{error}</p>
              )}
            </div>

            <div className="shrink-0">
              {confirmingId === a.portalUserId ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 max-w-xs">
                  {a.customers.length > 1 ? (
                    <p className="text-xs text-red-800">
                      This login has access to <strong>{a.customers.length} customers</strong>:{' '}
                      {a.customers.map((c) => c.name).join(', ')}. Deleting it removes access to all of them.
                    </p>
                  ) : (
                    <p className="text-xs text-red-800">Delete this login? This can&apos;t be undone.</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(a.portalUserId)}
                      disabled={pending && deletingId === a.portalUserId}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {pending && deletingId === a.portalUserId ? 'Deleting…' : 'Yes, delete login'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={pending && deletingId === a.portalUserId}
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(a.portalUserId)}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors"
                >
                  Delete Login
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
