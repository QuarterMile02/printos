import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ALL_ROLES, ALL_TIERS } from '@/lib/permissions';
import type { Role, Tier } from '@/lib/permissions';

async function getClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, tier, organization_id')
    .eq('id', user.id)
    .single() as { data: { role: string; tier: string; organization_id: string } | null };
  if (!callerProfile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const isOwner = callerProfile.role === 'owner';
  const isManager = callerProfile.tier === 'manager' || callerProfile.tier === 'lead';

  const body = await request.json() as {
    role?: string;
    tier?: string;
    departments?: string[];
    title?: string;
    phone?: string;
    is_active?: boolean;
  };

  if (body.role !== undefined && !isOwner)
    return NextResponse.json({ error: 'Only owners can change roles.' }, { status: 403 });
  if (body.tier !== undefined && !isOwner)
    return NextResponse.json({ error: 'Only owners can change tiers.' }, { status: 403 });
  if (body.departments !== undefined && !isOwner && !isManager)
    return NextResponse.json({ error: 'Only owners and managers can assign departments.' }, { status: 403 });
  if ((body.title !== undefined || body.phone !== undefined || body.is_active !== undefined) && !isOwner && !isManager)
    return NextResponse.json({ error: 'Only owners and managers can edit profiles.' }, { status: 403 });

  if (body.role && !ALL_ROLES.includes(body.role as Role))
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  if (body.tier && !ALL_TIERS.includes(body.tier as Tier))
    return NextResponse.json({ error: 'Invalid tier.' }, { status: 400 });

  // Ensure target is in same org
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', targetId)
    .single() as { data: { organization_id: string } | null };
  if (!targetProfile || targetProfile.organization_id !== callerProfile.organization_id)
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (body.role !== undefined) update.role = body.role;
  if (body.tier !== undefined) update.tier = body.tier;
  if (body.departments !== undefined) update.departments = body.departments;
  if (body.title !== undefined) update.title = body.title || null;
  if (body.phone !== undefined) update.phone = body.phone || null;
  if (body.is_active !== undefined) update.is_active = body.is_active;

  if (Object.keys(update).length === 0) return NextResponse.json({});

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', targetId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
