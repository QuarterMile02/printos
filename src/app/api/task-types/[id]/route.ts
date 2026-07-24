import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function DELETE(
  _request: Request,
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

  const { data: taskType } = await supabase
    .from('task_types')
    .select('is_system')
    .eq('id', id)
    .single() as { data: { is_system: boolean } | null };

  if (!taskType) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (taskType.is_system) {
    return NextResponse.json({ error: 'System task types cannot be deleted' }, { status: 403 });
  }

  const { error } = await supabase.from('task_types').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
