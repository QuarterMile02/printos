import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import LeadsPageClient from './LeadsPageClient';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('organization_id, full_name, role')
    .eq('id', user.id)
    .single();
  const profile = profileRow as { organization_id: string; full_name: string; role: string } | null;

  return (
    <LeadsPageClient
      userId={user.id}
      orgId={profile?.organization_id ?? ''}
      slug={slug}
    />
  );
}
