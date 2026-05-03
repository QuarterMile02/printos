import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OrgSidebarNav } from './org-sidebar-nav'
import { checkPermission } from '@/lib/check-permission'

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function OrgLayout({ children, params }: LayoutProps) {
  console.log('[slug/layout] render start')
  try {
    const { slug } = await params
    console.log('[slug/layout] slug:', slug)

    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr) console.error('[slug/layout] auth error:', authErr.message)
    console.log('[slug/layout] user:', user?.id ?? 'NONE')

    if (!user) redirect('/login')

    const service = createServiceClient()
    const { data: org, error: orgErr } = await service
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle() as { data: { id: string } | null; error: { message: string } | null }
    if (orgErr) console.error('[slug/layout] org query error:', orgErr.message)
    console.log('[slug/layout] org id:', org?.id ?? 'NOT FOUND')

    let showReports = false
    if (org?.id) {
      try {
        const { allowed } = await checkPermission(org.id, 'reports.quotes')
        showReports = allowed
        console.log('[slug/layout] showReports:', showReports)
      } catch (err) {
        console.error('[slug/layout] CRASH checkPermission:', (err as Error)?.message, (err as Error)?.stack)
      }
    }

    async function signOut() {
      'use server'
      const sb = await createClient()
      await sb.auth.signOut()
      redirect('/login')
    }

    console.log('[slug/layout] rendering layout')
    return (
      <div className="flex flex-col md:flex-row h-screen bg-qm-surface">
        <OrgSidebarNav slug={slug} email={user!.email!} signOutAction={signOut} showReports={showReports} />
        <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">{children}</main>
      </div>
    )
  } catch (err) {
    console.error('[slug/layout] CRASH top-level:', (err as Error)?.message, (err as Error)?.stack)
    throw err
  }
}
