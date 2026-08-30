import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PUBLIC_SIGNUP_ENABLED } from '@/lib/auth-config'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  async function signUp(formData: FormData) {
    'use server'

    // THE GATE. First statement in the action, before the Supabase client is
    // even constructed. Hiding the form below is presentation, not a control:
    // a server action is a POST endpoint with a stable id, so anything that
    // has ever seen this page's payload can call it directly. This is the
    // door; the form is only the handle on it.
    if (!PUBLIC_SIGNUP_ENABLED) {
      redirect('/signup')
    }

    const supabase = await createClient()
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const fullName = formData.get('full_name') as string

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/callback`,
      },
    })

    if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`)
    redirect('/dashboard')
  }

  // Closed state. The action above already refuses independently of this —
  // this is what a person sees, not what enforces the policy.
  if (!PUBLIC_SIGNUP_ENABLED) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-qm-surface">
        <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
          <div>
            <h1 className="text-2xl font-extrabold uppercase text-qm-black">Invitation only</h1>
            <p className="mt-2 text-sm text-qm-gray">
              <span className="text-qm-lime font-semibold">PrintOS</span> accounts are created by
              invitation. Ask an owner or admin at your organization to invite you, and you&apos;ll
              get an email with a link to set your password.
            </p>
          </div>

          <a
            href="/login"
            className="block w-full rounded-md bg-qm-lime px-4 py-2 text-center text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2"
          >
            Go to sign in
          </a>

          <p className="text-center text-sm text-qm-gray">
            Already have an account?{' '}
            <a href="/login" className="font-semibold text-qm-lime hover:brightness-110">
              Sign in
            </a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-qm-surface">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Create your account</h1>
          <p className="mt-1 text-sm text-qm-gray">
            Get started with <span className="text-qm-lime font-semibold">PrintOS</span>
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {decodeURIComponent(error)}
          </div>
        )}

        <form action={signUp} className="space-y-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-semibold text-qm-black">
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              autoComplete="name"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
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
              minLength={8}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2"
          >
            Create account
          </button>
        </form>

        <p className="text-center text-sm text-qm-gray">
          Already have an account?{' '}
          <a href="/login" className="font-semibold text-qm-lime hover:brightness-110">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
