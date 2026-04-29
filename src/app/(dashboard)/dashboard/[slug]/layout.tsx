import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OrgSidebarNav } from './org-sidebar-nav'
import { checkPermission } from '@/lib/check-permission'

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function OrgLayout({ children, params }: LayoutProps) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Resolve the org id from the slug so we can permission-gate the
  // sidebar entries. Reports is shown only to owner / sales / accounting
  // (matches the role defaults in lib/permissions.ts).
  const service = createServiceClient()
  const { data: org } = await service
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  let showReports = false
  if (org?.id) {
    const { allowed } = await checkPermission(org.id, 'reports.quotes')
    showReports = allowed
  }

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <div className="flex flex-col md:flex-row h-screen bg-qm-surface">
      <OrgSidebarNav slug={slug} email={user.email!} signOutAction={signOut} showReports={showReports} />
      <main className="flex-1 min-h-0 min-w-0 overflow-y-auto">{children}</main>
    </div>
  )
}
