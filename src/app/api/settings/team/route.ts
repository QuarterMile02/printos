import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

async function getClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
}

// Fetches every profile in the org via the service client. The only SELECT
// policy ever defined on profiles (migration 001) is `auth.uid() = id`, so
// the anon/session client can only ever see the caller's own row -- this
// silently collapsed the member list down to 1 row regardless of any
// organization_id filter. /team-members hit and fixed this identical issue
// earlier by switching to the service client; this route just never got
// the same fix.
export async function GET() {
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!callerProfile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const orgId = (callerProfile as { organization_id: string }).organization_id;
  const service = createServiceClient();

  type ProfileRow = {
    id: string; full_name: string; title: string | null; phone: string | null;
    mobile: string | null; role: string; tier: string; departments: string[] | null;
    is_active: boolean;
  };
  const { data: profileRows, error } = await service
    .from('profiles')
    .select('id, full_name, title, phone, mobile, role, tier, departments, is_active')
    .eq('organization_id', orgId)
    .order('full_name') as { data: ProfileRow[] | null; error: { message: string } | null };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type OrgMemberRow = { user_id: string; role: string; created_at: string };
  const { data: orgMemberRows } = await service
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('organization_id', orgId) as { data: OrgMemberRow[] | null; error: unknown };

  const orgMemberMap = new Map<string, OrgMemberRow>();
  for (const m of orgMemberRows ?? []) orgMemberMap.set(m.user_id, m);

  const { data: { users: authUsers } } = await service.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  for (const u of authUsers ?? []) {
    if (u.email) emailMap.set(u.id, u.email);
  }

  const result = (profileRows ?? []).map((p) => ({
    ...p,
    email: emailMap.get(p.id) ?? null,
    org_role: orgMemberMap.get(p.id)?.role ?? null,
    joined_at: orgMemberMap.get(p.id)?.created_at ?? null,
  }));

  return NextResponse.json(result);
}
