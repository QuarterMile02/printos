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

export type UsedInRow = {
  type: 'QT' | 'SO' | 'IN';
  id: string;
  record_number: number;
  title: string | null;
  customer_name: string | null;
  status: string;
  created_at: string;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
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
  const service = createServiceClient();

  // Step 1 — all quote_ids that contain this product
  const { data: lineItems, error: liErr } = await service
    .from('quote_line_items')
    .select('quote_id')
    .eq('product_id', productId);

  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 });
  if (!lineItems || lineItems.length === 0) return NextResponse.json([]);

  const quoteIds = [...new Set(lineItems.map((li) => li.quote_id).filter(Boolean))];
  if (quoteIds.length === 0) return NextResponse.json([]);

  // Step 2 — fetch quotes, SOs, invoices in parallel (org-scoped)
  const [quotesRes, sosRes] = await Promise.all([
    service
      .from('quotes')
      .select('id, quote_number, title, status, created_at, customer_id')
      .in('id', quoteIds)
      .eq('organization_id', orgId),
    service
      .from('sales_orders')
      .select('id, so_number, quote_id, status, created_at')
      .in('quote_id', quoteIds)
      .eq('organization_id', orgId),
  ]);

  const quotes = quotesRes.data ?? [];
  const sos = sosRes.data ?? [];

  // Step 3 — invoices for those SOs
  const soIds = sos.map((s) => s.id);
  const invoicesRes = soIds.length > 0
    ? await service
        .from('invoices')
        .select('id, invoice_number, sales_order_id, status, created_at')
        .in('sales_order_id', soIds)
        .eq('organization_id', orgId)
    : { data: [] };
  const invoices = (invoicesRes as { data: { id: string; invoice_number: number; sales_order_id: string; status: string; created_at: string }[] | null }).data ?? [];

  // Step 4 — customer names
  const customerIds = [...new Set(quotes.map((q) => q.customer_id).filter(Boolean))];
  let customerMap: Record<string, string> = {};
  if (customerIds.length > 0) {
    const { data: custs } = await service
      .from('customers')
      .select('id, company_name, first_name, last_name')
      .in('id', customerIds);
    for (const c of custs ?? []) {
      customerMap[c.id] = c.company_name || `${c.first_name} ${c.last_name}`.trim();
    }
  }

  // Build quote → customer lookup for SO/IN rows
  const quoteCustomerMap: Record<string, string> = {};
  for (const q of quotes) {
    if (q.customer_id) quoteCustomerMap[q.id] = customerMap[q.customer_id] ?? null;
  }

  // SO → quote lookup for invoice customer names
  const soQuoteMap: Record<string, string> = {};
  for (const s of sos) {
    soQuoteMap[s.id] = s.quote_id;
  }

  const rows: UsedInRow[] = [];

  for (const q of quotes) {
    rows.push({
      type: 'QT',
      id: q.id,
      record_number: q.quote_number,
      title: q.title,
      customer_name: q.customer_id ? (customerMap[q.customer_id] ?? null) : null,
      status: q.status,
      created_at: q.created_at,
    });
  }
  for (const s of sos) {
    rows.push({
      type: 'SO',
      id: s.id,
      record_number: s.so_number,
      title: null,
      customer_name: quoteCustomerMap[s.quote_id] ?? null,
      status: s.status,
      created_at: s.created_at,
    });
  }
  for (const inv of invoices) {
    const quoteId = soQuoteMap[inv.sales_order_id];
    rows.push({
      type: 'IN',
      id: inv.id,
      record_number: inv.invoice_number,
      title: null,
      customer_name: quoteId ? (quoteCustomerMap[quoteId] ?? null) : null,
      status: inv.status,
      created_at: inv.created_at,
    });
  }

  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json(rows);
}

// DELETE — guarded by usage count; no UI currently calls this, but the guard is here for safety
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
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
    return NextResponse.json({ error: 'Only owners and admins can delete products.' }, { status: 403 });
  }

  const service = createServiceClient();

  // Usage check
  const { count, error: countError } = await service
    .from('quote_line_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `This product is used in ${count} transaction(s) and cannot be deleted. Disable it instead.` },
      { status: 409 }
    );
  }

  const { error } = await service
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('organization_id', profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
