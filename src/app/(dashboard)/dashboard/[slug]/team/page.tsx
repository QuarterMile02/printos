import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { OrgRole, InviteStatus } from '@/types/database'
import InviteMemberForm from './invite-member-form'

type PageProps = { params: Promise<{ slug: string }> }

const ROLE_STYLES: Record<OrgRole, string> = {
  owner:      'bg-qm-lime-light text-qm-lime',
  admin:      'bg-qm-gray-light text-qm-gray',
  designer:   'bg-qm-fuchsia-light text-qm-fuchsia',
  accountant: 'bg-amber-50 text-amber-700',
  member:     'bg-qm-black/5 text-qm-black',
  viewer:     'bg-qm-surface text-qm-gray',
}

const INVITE_STATUS_STYLES: Record<InviteStatus, string> = {
  pending:  'bg-amber-50 text-amber-700',
  accepted: 'bg-green-50 text-green-700',
  expired:  'bg-gray-100 text-gray-500',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function TeamPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Get current user's role to decide if they can invite
  const { data: { user } } = await supabase.auth.getUser()
  type MembershipRow = { role: OrgRole }
  const { data: currentMembership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user!.id)
    .single() as { data: MembershipRow | null; error: unknown }

  const currentRole = currentMembership?.role ?? 'viewer'
  const canInvite = currentRole === 'owner' || currentRole === 'admin'

  // Fetch members with profile data (via RLS — members can view other members)
  type MemberRow = { id: string; user_id: string; role: OrgRole; created_at: string; profiles: { full_name: string | null } | null }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('id, user_id, role, created_at, profiles(full_name)')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: true }) as { data: MemberRow[] | null; error: unknown }

  const members = memberRows ?? []

  // Use service client to get emails from auth.users for each member
  const service = createServiceClient()
  const emailMap = new Map<string, string>()
  if (members.length > 0) {
    const { data: { users: authUsers } } = await service.auth.admin.listUsers()
    for (const u of authUsers ?? []) {
      if (u.email) emailMap.set(u.id, u.email)
    }
  }

  // Fetch pending invites (visible to all members via RLS)
  type InviteRow = { id: string; email: string; role: OrgRole; status: InviteStatus; created_at: string; expires_at: string }
  const { data: inviteRows } = await supabase
    .from('organization_invites')
    .select('id, email, role, status, created_at, expires_at')
    .eq('organization_id', org.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false }) as { data: InviteRow[] | null; error: unknown }

  const pendingInvites = inviteRows ?? []

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Team</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
            <p className="mt-1 text-sm text-gray-500">
              {members.length} member{members.length === 1 ? '' : 's'}
            </p>
          </div>
          {canInvite && <InviteMemberForm orgId={org.id} orgSlug={org.slug} />}
        </div>
      </div>

      {/* Members table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Member
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                Joined
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((member) => {
              const name = member.profiles?.full_name
              const email = emailMap.get(member.user_id)
              const isCurrentUser = member.user_id === user!.id

              return (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-600">
                        {name ? name.charAt(0).toUpperCase() : email ? email.charAt(0).toUpperCase() : '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {name || 'Unnamed'}
                          {isCurrentUser && (
                            <span className="ml-1.5 text-xs text-gray-400">(you)</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {email ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ROLE_STYLES[member.role]}`}>
                      {member.role}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {formatDate(member.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            Pending Invites
            <span className="ml-2 text-sm font-normal text-gray-500">({pendingInvites.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Invited
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Expires
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingInvites.map((invite) => (
                  <tr key={invite.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {invite.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ROLE_STYLES[invite.role]}`}>
                        {invite.role}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${INVITE_STATUS_STYLES[invite.status]}`}>
                        {invite.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(invite.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(invite.expires_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
