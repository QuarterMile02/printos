import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SalesLeadsSettingsClient from './SalesLeadsSettingsClient';

export const dynamic = 'force-dynamic';

export default async function SalesLeadsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return <SalesLeadsSettingsClient slug={slug} />;
}
