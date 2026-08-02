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

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const { data, error } = await supabase
    .from('portal_tier_discounts')
    .select('unit_of_business, product_type, discount_percent')
    .eq('tier_id', id)
    .eq('organization_id', profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const rows: { unit_of_business: string; product_type: string; discount_percent: number }[] =
    await request.json();

  // Replace all rows for this tier
  const { error: deleteError } = await supabase
    .from('portal_tier_discounts')
    .delete()
    .eq('tier_id', id)
    .eq('organization_id', profile.organization_id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const toInsert = rows
    .filter((r) => typeof r.discount_percent === 'number' && r.discount_percent > 0)
    .map((r) => ({
      unit_of_business: r.unit_of_business,
      product_type: r.product_type,
      discount_percent: r.discount_percent,
      tier_id: id,
      organization_id: profile.organization_id,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('portal_tier_discounts').insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
