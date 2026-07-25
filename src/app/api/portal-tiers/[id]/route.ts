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

  const body = await request.json();
  const patch: Record<string, unknown> = {};
  if ('name' in body) patch.name = body.name?.trim() || null;
  if ('is_active' in body) patch.is_active = body.is_active;

  const { data, error } = await supabase
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
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  if (profile.role !== 'owner' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners can delete portal tiers.' }, { status: 403 });
  }

  // Always soft-delete — never hard delete
  const { data, error } = await supabase
    .from('portal_tiers')
    .update({ is_active: false })
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .select('id, name, is_active, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
