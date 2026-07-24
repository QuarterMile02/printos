import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

async function getClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

const DEFAULTS = [
  { name: 'General', is_concept: false, is_system: true },
  { name: 'Office / Dept Improvement', is_concept: false, is_system: true },
  { name: 'Measurement Visit', is_concept: true, is_system: true },
  { name: 'Internal Mockup', is_concept: true, is_system: true },
  { name: 'External Proof', is_concept: true, is_system: true },
  { name: 'Material Planning', is_concept: true, is_system: true },
  { name: 'Sample Build', is_concept: true, is_system: true },
  { name: 'Other', is_concept: false, is_system: true },
];

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

  const orgId = profile.organization_id as string;

  const { data: existing } = await supabase
    .from('task_types')
    .select('id, name, is_concept, is_system')
    .eq('org_id', orgId)
    .order('name');

  if (existing && existing.length > 0) {
    return NextResponse.json(existing);
  }

  // Seed defaults
  const { data: seeded, error: seedError } = await supabase
    .from('task_types')
    .insert(DEFAULTS.map(d => ({ ...d, org_id: orgId })))
    .select('id, name, is_concept, is_system')
    .order('name');

  if (seedError) return NextResponse.json({ error: seedError.message }, { status: 500 });
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

  const body = await request.json() as { name: string; is_concept: boolean };
  if (!body.name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const { data, error } = await supabase
    .from('task_types')
    .insert({
      org_id: profile.organization_id,
      name: body.name.trim(),
      is_concept: !!body.is_concept,
      is_system: false,
    })
    .select('id, name, is_concept, is_system')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
