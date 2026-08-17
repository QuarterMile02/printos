'use client'

import { useState, useTransition } from 'react'
import { acceptInvite } from '../actions'

export default function AcceptInviteForm({ token }: { token: string }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await acceptInvite(token, password, confirmPassword)
      // On success the action redirects server-side and never returns here.
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-qm-black">Password</label>
        <input
          id="password" type="password" required minLength={8} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
        <p className="mt-1 text-xs text-qm-gray">At least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-semibold text-qm-black">Confirm Password</label>
        <input
          id="confirmPassword" type="password" required minLength={8} autoComplete="new-password"
          value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </div>
      <button
        type="submit" disabled={pending}
        className="w-full rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2 disabled:opacity-50"
      >
        {pending ? 'Setting up…' : 'Set Password & Sign In'}
      </button>
    </form>
  )
}
