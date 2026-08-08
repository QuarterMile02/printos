import { createServiceClient } from '@/lib/supabase/server'
import AutoPrint from './auto-print'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PageProps = { params: Promise<{ token: string; proofId: string }> }

function isPdf(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf')
}

function InvalidLink() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-center">
      <p className="text-sm text-gray-500">This print link is invalid or no longer available.</p>
    </div>
  )
}

// Item 4 — dedicated print view, opened in a new tab from the customer-facing
// review page's "Print" button, in place of the old raw-file "Open PDF" /
// linked-image download affordance. Public + unauthenticated like the review
// page itself, so it re-derives its own read-only copy of the same
// token -> proof_sends -> proof_send_items membership check used by
// respond-to-proof-core.ts's write path (see that file's header for the full
// security model) rather than trusting proofId alone — nothing here mutates
// state, but the token is still the only thing standing between an anonymous
// caller and any given proof's file.
export default async function ProofPrintPage({ params }: PageProps) {
  const { token, proofId } = await params
  if (!UUID_RE.test(token) || !UUID_RE.test(proofId)) return <InvalidLink />

  const service = createServiceClient()

  const { data: send } = (await service
    .from('proof_sends')
    .select('id, organization_id')
    .eq('token', token)
    .maybeSingle()) as { data: { id: string; organization_id: string } | null }
  if (!send) return <InvalidLink />

  const { data: sendItem } = (await service
    .from('proof_send_items')
    .select('id, organization_id')
    .eq('proof_send_id', send.id)
    .eq('proof_version_id', proofId)
    .maybeSingle()) as { data: { id: string; organization_id: string } | null }
  if (!sendItem || sendItem.organization_id !== send.organization_id) return <InvalidLink />

  const { data: proof } = (await service
    .from('proof_versions')
    .select('id, organization_id, file_url, file_name')
    .eq('id', proofId)
    .maybeSingle()) as { data: { id: string; organization_id: string; file_url: string; file_name: string } | null }
  if (!proof || proof.organization_id !== send.organization_id) return <InvalidLink />

  return (
    <div className="min-h-screen bg-white p-6 print:p-0">
      <AutoPrint />
      <div className="mb-4 print:hidden">
        <p className="text-sm text-gray-500">{proof.file_name} — use your browser&apos;s print dialog, or close this tab to go back.</p>
      </div>
      {isPdf(proof.file_name) ? (
        <iframe src={proof.file_url} className="h-[90vh] w-full border-0 print:h-screen" title={proof.file_name} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={proof.file_url} alt={proof.file_name} className="mx-auto max-w-full" />
      )}
    </div>
  )
}
