import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  async function signInWithEmail(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-qm-surface">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Sign in to <span className="text-qm-lime">PrintOS</span></h1>
          <p className="mt-1 text-sm text-qm-gray">
            Manage your print shop operations
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {decodeURIComponent(error)}
          </div>
        )}

        <form action={signInWithEmail} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-qm-black">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-qm-black">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2"
          >
            Sign in
          </button>
        </form>

        <p className="text-center text-sm text-qm-gray">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="font-semibold text-qm-lime hover:brightness-110">
            Create one
          </a>
        </p>
      </div>
    </div>
  )
}
