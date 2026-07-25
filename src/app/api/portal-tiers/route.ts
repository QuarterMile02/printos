import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('[portal-tiers GET] profile lookup error:', profileError.message);
  }
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const orgId = profile.organization_id;
  console.log('[portal-tiers GET] org_id:', orgId);

  // Use service client so SELECT + INSERT are not blocked by RLS edge cases
  const service = createServiceClient();

  const { data: tiers, error: tiersError } = await service
    .from('portal_tiers')
    .select('id, name, is_active, created_at')
    .eq('organization_id', orgId)
    .order('name');

  if (tiersError) {
    console.error('[portal-tiers GET] tiers select error:', tiersError.message);
    return NextResponse.json({ error: tiersError.message }, { status: 500 });
  }

  if (tiers && tiers.length > 0) {
    const { data: cusData } = await service
      .from('customers')
      .select('portal_tier_id')
      .eq('organization_id', orgId)
      .not('portal_tier_id', 'is', null);

    const countMap: Record<string, number> = {};
    for (const c of cusData ?? []) {
      if (c.portal_tier_id) countMap[c.portal_tier_id] = (countMap[c.portal_tier_id] ?? 0) + 1;
    }

    return NextResponse.json(tiers.map((t) => ({ ...t, customer_count: countMap[t.id] ?? 0 })));
  }

  // No tiers yet — seed 5 defaults on first load
  console.log('[portal-tiers GET] no tiers found for org, seeding defaults:', DEFAULT_TIERS);

  const { data: seeded, error: seedError } = await service
    .from('portal_tiers')
    .insert(DEFAULT_TIERS.map((name) => ({ name, organization_id: orgId, is_active: true })))
    .select('id, name, is_active, created_at');

  if (seedError) {
    console.error('[portal-tiers GET] seed insert error:', seedError.message, seedError);
    return NextResponse.json({ error: seedError.message }, { status: 500 });
  }

  console.log('[portal-tiers GET] seeded', seeded?.length ?? 0, 'tiers');

  // Sort by name client-side since ORDER BY is not reliable on INSERT...SELECT
  const sorted = (seeded ?? []).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(sorted.map((t) => ({ ...t, customer_count: 0 })));
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

  const service = createServiceClient();
  const { data, error } = await service
    .from('portal_tiers')
    .insert({ name, organization_id: profile.organization_id, is_active: true })
    .select('id, name, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, customer_count: 0 });
}
