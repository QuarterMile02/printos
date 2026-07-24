import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const DEFAULT_STAGES = [
  { name: 'Assigned',        color: '#6B7280', sort_order: 0, is_won: false, is_lost: false },
  { name: 'Contacted',       color: '#3B82F6', sort_order: 1, is_won: false, is_lost: false },
  { name: 'Rough Estimate',  color: '#8B5CF6', sort_order: 2, is_won: false, is_lost: false },
  { name: 'Preparing Quote', color: '#F59E0B', sort_order: 3, is_won: false, is_lost: false },
  { name: 'Quoted',          color: '#EF4444', sort_order: 4, is_won: false, is_lost: false },
  { name: 'Won',             color: '#10B981', sort_order: 5, is_won: true,  is_lost: false },
];

async function getClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

export async function GET() {
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('org_id', profile.organization_id)
    .order('sort_order');

  if (stages && stages.length > 0) return NextResponse.json(stages);

  // Auto-seed defaults on first load
  const { data: seeded, error } = await supabase
    .from('pipeline_stages')
    .insert(DEFAULT_STAGES.map(s => ({ ...s, org_id: profile.organization_id })))
    .select()
    .order('sort_order');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(seeded ?? []);
}

export async function POST(request: Request) {
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const body = await request.json();
  const { data, error } = await supabase
    .from('pipeline_stages')
    .insert({ ...body, org_id: profile.organization_id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
