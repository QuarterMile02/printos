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
    .from('payments')
    .select('id, payment_number, customer_id, amount_paid, payment_method, balance, applied, refunded_amount, paid_on, note, created_at')
    .eq('organization_id', profile.organization_id)
    .order('paid_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST removed -- this used to be logPayment's write path
// (CustomerTabsSection.tsx): a raw payments insert with no invoice_id
// sent and no application ever created. Recording a payment now goes
// through src/app/actions/record-payment.ts, which writes payments +
// payment_applications in one transaction via the record_payment() RPC
// (migration 165). Do not resurrect a direct insert here -- that's
// exactly the second, disconnected write path this redesign removed.
