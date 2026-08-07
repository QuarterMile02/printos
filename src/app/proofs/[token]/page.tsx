import { createServiceClient } from '@/lib/supabase/server'
import ProofResponseClient, { type ProofItem } from './proof-response-client'

export const dynamic = 'force-dynamic'

// Public, unauthenticated customer-facing proof review page. Reached from
// the "Send Proofs" email (sales-orders/[id]/proof-actions.ts). No
// Supabase auth session exists here — every read below goes through the
// service-role client with the token as the sole scoping filter, same
// security model as respond-to-proof-core.ts (the write side). Read
// carefully before adding new queries here: nothing should ever be
// fetched using proofVersionId/lineItemId alone without first resolving
// them through this token's own proof_sends/proof_send_items rows.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PageProps = { params: Promise<{ token: string }> }

function InvalidLink({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold text-gray-900">Link not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          {message ?? 'This proof review link is invalid or no longer available. Please contact us if you need a new one.'}
        </p>
      </div>
    </div>
  )
}

export default async function ProofLinkPage({ params }: PageProps) {
  const { token } = await params
  if (!UUID_RE.test(token)) return <InvalidLink />

  const service = createServiceClient()

  const { data: send } = await service
    .from('proof_sends')
    .select('id, organization_id, sales_order_id')
    .eq('token', token)
    .maybeSingle() as { data: { id: string; organization_id: string; sales_order_id: string } | null }
  if (!send) return <InvalidLink />

  const [orgRes, soRes, sendItemsRes] = await Promise.all([
    service.from('organizations').select('name').eq('id', send.organization_id).maybeSingle(),
    service.from('sales_orders').select('so_number').eq('id', send.sales_order_id).maybeSingle(),
    service.from('proof_send_items').select('proof_version_id').eq('proof_send_id', send.id),
  ])
  const org = orgRes.data as { name: string } | null
  const so = soRes.data as { so_number: number } | null
  const sendItems = sendItemsRes.data as { proof_version_id: string }[] | null

  const proofVersionIds = (sendItems ?? []).map((i) => i.proof_version_id)
  if (proofVersionIds.length === 0) return <InvalidLink message="This link has no proofs attached." />

  const { data: proofRows } = await service
    .from('proof_versions')
    .select('id, quote_line_item_id, file_url, file_name, version_number, status, customer_feedback, customer_responded_at')
    .in('id', proofVersionIds) as {
      data: {
        id: string; quote_line_item_id: string | null; file_url: string; file_name: string
        version_number: number; status: string; customer_feedback: string | null; customer_responded_at: string | null
      }[] | null
    }

  const lineItemIds = Array.from(new Set((proofRows ?? []).map((p) => p.quote_line_item_id).filter(Boolean))) as string[]
  const labelById = new Map<string, string>()
  if (lineItemIds.length > 0) {
    const { data: liRows } = await service
      .from('quote_line_items')
      .select('id, description, width, height')
      .in('id', lineItemIds) as { data: { id: string; description: string | null; width: number | null; height: number | null }[] | null }
    for (const li of liRows ?? []) {
      const dims = li.width != null && li.height != null ? ` ${li.width}″×${li.height}″` : ''
      labelById.set(li.id, `${li.description ?? 'Line item'}${dims}`)
    }
  }

  const items: ProofItem[] = (proofRows ?? []).map((p) => ({
    id: p.id,
    label: p.quote_line_item_id ? (labelById.get(p.quote_line_item_id) ?? 'Line item') : p.file_name,
    fileUrl: p.file_url,
    fileName: p.file_name,
    versionNumber: p.version_number,
    status: (p.status === 'approved' || p.status === 'rejected' ? p.status : 'pending'),
    customerFeedback: p.customer_feedback,
    customerRespondedAt: p.customer_responded_at,
  }))

  return (
    <ProofResponseClient
      token={token}
      orgName={org?.name ?? 'your print shop'}
      soLabel={so ? `SO-${String(so.so_number).padStart(4, '0')}` : null}
      initialItems={items}
    />
  )
}
