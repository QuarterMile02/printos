import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { checkPermission } from '@/lib/check-permission';

async function getClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { allowed } = await checkPermission(profile.organization_id, 'portal_tiers.manage');
  if (!allowed) {
    return NextResponse.json({ error: 'You do not have permission to manage portal tiers.' }, { status: 403 });
  }

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if ('name' in body) patch.name = body.name?.trim() || null;
  if ('is_active' in body) patch.is_active = body.is_active;

  // Use service client — portal_tiers has RLS enabled with zero policies,
  // so a normal cookie-bound client can never see/affect any row here.
  // Authorization is enforced above via checkPermission(), not RLS.
  const service = createServiceClient();
  const { data, error } = await service
    .from('portal_tiers')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .select('id, name, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { allowed } = await checkPermission(profile.organization_id, 'portal_tiers.manage');
  if (!allowed) {
    return NextResponse.json({ error: 'You do not have permission to manage portal tiers.' }, { status: 403 });
  }

  // Always soft-delete — never hard delete
  const service = createServiceClient();
  const { data, error } = await service
    .from('portal_tiers')
    .update({ is_active: false })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .select('id, name, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
