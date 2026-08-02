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

  const { data, error } = await supabase
    .from('sample_work_orders')
    .select(`
      *,
      product:products(id, name),
      assigned_profile:profiles!sample_work_orders_assigned_to_fkey(id, full_name)
    `)
    .eq('org_id', profile.organization_id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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

  const body = await request.json() as {
    task_id?: string;
    title: string;
    product_id?: string;
    assigned_to?: string;
    departments?: string[];
    notes?: string;
  };

  if (!body.title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 });

  const { data: swo, error } = await supabase
    .from('sample_work_orders')
    .insert({
      org_id: profile.organization_id,
      task_id: body.task_id || null,
      title: body.title.trim(),
      product_id: body.product_id || null,
      assigned_to: body.assigned_to || null,
      departments: body.departments ?? [],
      notes: body.notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update task to record the SWO id
  if (body.task_id && swo) {
    const { error: linkError } = await supabase
      .from('tasks')
      .update({ sample_work_order_id: swo.id, is_sample_work_order: true })
      .eq('id', body.task_id);
    if (linkError) {
      console.error('[sample-work-orders POST] Failed to link task back to SWO:', linkError.message, { taskId: body.task_id, swoId: swo.id });
      return NextResponse.json({ ...swo, _warning: 'Sample work order created, but linking it back to the task failed.' });
    }
  }

  return NextResponse.json(swo);
}
