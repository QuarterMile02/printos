import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const DEFAULT_TIERS = ['Political', 'Reseller', 'Retail', 'VIP', 'Wholesale'];

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

  const { data: tiers } = await supabase
    .from('portal_tiers')
    .select('id, name, is_active, created_at')
    .eq('organization_id', profile.organization_id)
    .order('name');

  if (tiers && tiers.length > 0) {
    const { data: cusData } = await supabase
      .from('customers')
      .select('portal_tier_id')
      .eq('organization_id', profile.organization_id)
      .not('portal_tier_id', 'is', null);

    const countMap: Record<string, number> = {};
    for (const c of cusData ?? []) {
      if (c.portal_tier_id) countMap[c.portal_tier_id] = (countMap[c.portal_tier_id] ?? 0) + 1;
    }

    return NextResponse.json(tiers.map((t) => ({ ...t, customer_count: countMap[t.id] ?? 0 })));
  }

  // Seed 5 default tiers on first load
  const { data: seeded, error } = await supabase
    .from('portal_tiers')
    .insert(DEFAULT_TIERS.map((name) => ({ name, organization_id: profile.organization_id, is_active: true })))
    .select('id, name, is_active, created_at')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((seeded ?? []).map((t) => ({ ...t, customer_count: 0 })));
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
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('portal_tiers')
    .insert({ name, organization_id: profile.organization_id, is_active: true })
    .select('id, name, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, customer_count: 0 });
}
