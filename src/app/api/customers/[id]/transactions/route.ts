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
  const { id: customerId } = await params;
  const supabase = await getClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 });

  const orgId = profile.organization_id;

  const [quotesRes, soRes, invRes] = await Promise.all([
    supabase
      .from('quotes')
      .select('id, quote_number, title, total, status, created_at')
      .eq('customer_id', customerId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('sales_orders')
      .select('id, so_number, title, total, status, created_at')
      .eq('customer_id', customerId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('invoices')
      .select('id, invoice_number, total, status, due_date, created_at')
      .eq('customer_id', customerId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const rows: {
    id: string;
    type: 'QT' | 'SO' | 'IN';
    record_number: number;
    title: string | null;
    total: number;
    status: string;
    created_at: string;
    due_date?: string | null;
  }[] = [];

  for (const q of quotesRes.data ?? []) {
    rows.push({ id: q.id, type: 'QT', record_number: q.quote_number, title: q.title, total: q.total ?? 0, status: q.status, created_at: q.created_at });
  }
  for (const s of soRes.data ?? []) {
    rows.push({ id: s.id, type: 'SO', record_number: s.so_number, title: s.title, total: s.total ?? 0, status: s.status, created_at: s.created_at });
  }
  for (const inv of invRes.data ?? []) {
    rows.push({ id: inv.id, type: 'IN', record_number: inv.invoice_number, title: null, total: inv.total ?? 0, status: inv.status, created_at: inv.created_at, due_date: inv.due_date });
  }

  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json(rows);
}
