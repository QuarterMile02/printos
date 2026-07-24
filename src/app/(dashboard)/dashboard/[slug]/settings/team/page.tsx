import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import TeamSettingsClient from './TeamSettingsClient';

export const dynamic = 'force-dynamic';

export default async function TeamSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('role, tier, organization_id')
    .eq('id', user.id)
    .single();
  const profile = profileRow as { role: string; tier: string; organization_id: string } | null;

  return (
    <TeamSettingsClient
      slug={slug}
      currentUserId={user.id}
      currentUserRole={profile?.role ?? 'staff'}
      currentUserTier={profile?.tier ?? 'staff'}
    />
  );
}
