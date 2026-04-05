import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OrgSidebarNav } from './org-sidebar-nav'

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function OrgLayout({ children, params }: LayoutProps) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <div className="flex min-h-full">
      <OrgSidebarNav slug={slug} email={user.email!} signOutAction={signOut} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
