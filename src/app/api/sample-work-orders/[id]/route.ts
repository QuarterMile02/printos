import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json() as {
    status?: string;
    notes?: string;
    assigned_to?: string;
  };

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === 'done') update.completed_at = new Date().toISOString();
    else update.completed_at = null;
  }
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.assigned_to !== undefined) update.assigned_to = body.assigned_to || null;

  const { data, error } = await supabase
    .from('sample_work_orders')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
