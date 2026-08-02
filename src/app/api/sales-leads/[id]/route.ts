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

  const body = await request.json();
  const updateData: Record<string, unknown> = {
    ...body,
    updated_at: new Date().toISOString(),
  };

  // Auto-set won_at / lost_at based on destination stage
  if (body.stage_id) {
    const { data: stage, error: stageError } = await supabase
      .from('pipeline_stages')
      .select('is_won, is_lost')
      .eq('id', body.stage_id)
      .single();
    if (stageError) return NextResponse.json({ error: stageError.message }, { status: 500 });

    if (stage?.is_won) {
      updateData.won_at = updateData.won_at ?? new Date().toISOString();
      updateData.lost_at = null;
      updateData.lost_reason = null;
    } else if (stage?.is_lost) {
      updateData.lost_at = updateData.lost_at ?? new Date().toISOString();
      updateData.won_at = null;
    } else {
      updateData.won_at = null;
      updateData.lost_at = null;
    }
  }

  const { data, error } = await supabase
    .from('sales_leads')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('sales_leads').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
