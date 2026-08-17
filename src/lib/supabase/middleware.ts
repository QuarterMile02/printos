import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — do not add logic between createServerClient and getUser
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup')
  const isPasswordRoute = pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')
  const isApiRoute = pathname.startsWith('/api')
  // Public, token-authenticated customer proof-review page (migration
  // 119) -- no Supabase session exists for a customer following this
  // link, and it shouldn't: proof_sends.token is its own, separate
  // security boundary, validated server-side per-request in
  // respond-to-proof-core.ts. See that file for the actual access
  // control; this just stops the redirect-to-/login that would otherwise
  // block every anonymous visit before the page even runs.
  const isProofReviewRoute = pathname.startsWith('/proofs/')
  // Customer Portal auth entry points (build plan rev. 2, step 3) -- a
  // portal contact is, by definition, NOT logged in yet when they hit
  // these, same reasoning as isProofReviewRoute above. /portal itself
  // (the landing page) stays protected -- only these two need to be
  // reachable while logged out. Found live during end-to-end testing:
  // without this, an anonymous contact clicking their real invite link
  // got bounced to staff /login before ever seeing the accept-invite
  // page -- the first test pass only "worked" because the tester
  // happened to still be authenticated as staff at that exact moment.
  const isPortalAuthRoute = pathname.startsWith('/portal/login') || pathname.startsWith('/portal/accept-invite')
  const isPublicRoute = pathname === '/' || isAuthRoute || isPasswordRoute || isApiRoute || isProofReviewRoute || isPortalAuthRoute

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    // Send a logged-out /portal visitor to the portal's own login page,
    // not staff /login -- they're a customer, not staff, and even if
    // they somehow had staff credentials, staff /login redirects
    // authenticated users to /dashboard, not back to /portal.
    url.pathname = pathname.startsWith('/portal') ? '/portal/login' : '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
