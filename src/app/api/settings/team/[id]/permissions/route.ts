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

async function getCallerAndOrg(supabase: Awaited<ReturnType<typeof getClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, tier, organization_id')
    .eq('id', user.id)
    .single() as { data: { role: string; tier: string; organization_id: string } | null };
  if (!profile) return null;
  return { user, profile };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const supabase = await getClient();
  const caller = await getCallerAndOrg(supabase);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('permission_overrides')
    .select('id, permission_key, granted')
    .eq('user_id', targetId)
    .eq('organization_id', caller.profile.organization_id)
    .order('permission_key');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const supabase = await getClient();
  const caller = await getCallerAndOrg(supabase);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profile, user } = caller;
  const canManage = profile.role === 'owner' || profile.tier === 'manager' || profile.tier === 'lead';
  if (!canManage)
    return NextResponse.json({ error: 'Only owners and managers can manage permission overrides.' }, { status: 403 });

  const body = await request.json() as { permission_key: string; granted: boolean };
  if (!body.permission_key) return NextResponse.json({ error: 'permission_key required' }, { status: 400 });

  const { error } = await supabase
    .from('permission_overrides')
    .upsert(
      {
        user_id: targetId,
        organization_id: profile.organization_id,
        permission_key: body.permission_key,
        granted: body.granted,
        granted_by: user.id,
        granted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,permission_key' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const supabase = await getClient();
  const caller = await getCallerAndOrg(supabase);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profile } = caller;
  const canManage = profile.role === 'owner' || profile.tier === 'manager' || profile.tier === 'lead';
  if (!canManage)
    return NextResponse.json({ error: 'Only owners and managers can manage permission overrides.' }, { status: 403 });

  const body = await request.json() as { permission_key: string };
  if (!body.permission_key) return NextResponse.json({ error: 'permission_key required' }, { status: 400 });

  const { error } = await supabase
    .from('permission_overrides')
    .delete()
    .eq('user_id', targetId)
    .eq('organization_id', profile.organization_id)
    .eq('permission_key', body.permission_key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
