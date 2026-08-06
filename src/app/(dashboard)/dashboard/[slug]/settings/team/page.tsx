import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import type { OrgRole, InviteStatus } from '@/types/database';
import TeamSettingsClient from './TeamSettingsClient';

export const dynamic = 'force-dynamic';

export default async function TeamSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  type OrgRow = { id: string; name: string; slug: string };
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown };
  if (!org) notFound();

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('role, tier, organization_id')
    .eq('id', user.id)
    .single();
  const profile = profileRow as { role: string; tier: string; organization_id: string } | null;

  type MembershipRow = { role: OrgRole };
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: MembershipRow | null; error: unknown };

  const canInvite = membership?.role === 'owner' || membership?.role === 'admin';

  type InviteRow = { id: string; email: string; role: OrgRole; status: InviteStatus; created_at: string; expires_at: string };
  const { data: inviteRows } = await supabase
    .from('organization_invites')
    .select('id, email, role, status, created_at, expires_at')
    .eq('organization_id', org.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false }) as { data: InviteRow[] | null; error: unknown };

  return (
    <TeamSettingsClient
      slug={slug}
      orgId={org.id}
      orgSlug={org.slug}
      currentUserId={user.id}
      currentUserRole={profile?.role ?? 'staff'}
      currentUserTier={profile?.tier ?? 'staff'}
      canInvite={canInvite}
      pendingInvites={inviteRows ?? []}
    />
  );
}
