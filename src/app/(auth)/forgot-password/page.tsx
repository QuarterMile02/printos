import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const { error, success } = await searchParams

  async function sendResetLink(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const email = formData.get('email') as string

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?type=recovery`,
    })
    if (error) {
      console.error('[forgot-password] resetPasswordForEmail error:', error)
      redirect(`/forgot-password?error=${encodeURIComponent(error.message)}`)
    }
    redirect(`/forgot-password?success=${encodeURIComponent(email)}`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-qm-surface">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Forgot Password</h1>
          <p className="mt-1 text-sm text-qm-gray">
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        {success ? (
          <div className="rounded-md bg-green-50 p-4 text-sm text-green-700 border border-green-200">
            Check your email — we sent a password reset link to {decodeURIComponent(success)}
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                {decodeURIComponent(error)}
              </div>
            )}

            <form action={sendResetLink} className="space-y-4">
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
              <button
                type="submit"
                className="w-full rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2"
              >
                Send Reset Link
              </button>
            </form>
          </>
        )}

        <p className="text-center text-sm text-qm-gray">
          Remember your password?{' '}
          <a href="/login" className="font-semibold text-qm-lime hover:brightness-110">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}
