import { OrgSidebarNav } from './org-sidebar-nav'

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function OrgLayout({ children, params }: LayoutProps) {
  const { slug } = await params

  return (
    <div className="flex min-h-full">
      <OrgSidebarNav slug={slug} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
