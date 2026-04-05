import { createClient } from '@/lib/supabase/server'
import type { OrgRole } from '@/types/database'
import CreateOrgForm from './create-org-form'

type MembershipRow = {
  role: OrgRole
  organizations: {
    id: string
    name: string
    slug: string
  } | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('role, organizations(id, name, slug)')
    .eq('user_id', user!.id) as { data: MembershipRow[] | null; error: unknown }

  const orgs = (memberships ?? [])
    .filter((m) => m.organizations !== null)
    .map((m) => ({
      id: m.organizations!.id,
      name: m.organizations!.name,
      slug: m.organizations!.slug,
      role: m.role,
    }))

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">Dashboard</h1>
          <p className="mt-1 text-sm text-qm-gray">Welcome back, {user?.email}</p>
        </div>
        <CreateOrgForm />
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-bold text-qm-black mb-4">Your Organizations</h2>
        {orgs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgs.map((org) => (
              <a
                key={org.id}
                href={`/dashboard/${org.slug}`}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
              >
                <div className="font-bold text-qm-black">{org.name}</div>
                <div className="mt-1 text-sm text-qm-gray">/{org.slug}</div>
                <div className="mt-3">
                  <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime capitalize">
                    {org.role}
                  </span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-sm text-qm-gray">No organizations yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
