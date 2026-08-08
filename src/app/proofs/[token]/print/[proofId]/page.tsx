import { createServiceClient } from '@/lib/supabase/server'
import { verifyProofSendMembership } from '@/lib/proofs/verify-proof-send-membership'
import AutoPrint from './auto-print'

export const dynamic = 'force-dynamic'

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
// page itself, so it goes through the same shared token -> proof_sends ->
// proof_send_items membership check (verifyProofSendMembership) used by
// respond-to-proof-core.ts's write path and uploadProofMarkup (see that
// file's header for the full security model) rather than trusting proofId
// alone — nothing here mutates state, but the token is still the only thing
// standing between an anonymous caller and any given proof's file. No
// status check on top (unlike those two) — an already-approved/rejected
// proof can still be printed.
export default async function ProofPrintPage({ params }: PageProps) {
  const { token, proofId } = await params
  const service = createServiceClient()

  const result = await verifyProofSendMembership(service, token, proofId)
  if (!result.ok) return <InvalidLink />
  const { membership } = result

  return (
    <div className="min-h-screen bg-white p-6 print:p-0">
      <AutoPrint />
      <div className="mb-4 print:hidden">
        <p className="text-sm text-gray-500">{membership.fileName} — use your browser&apos;s print dialog, or close this tab to go back.</p>
      </div>
      {isPdf(membership.fileName) ? (
        <iframe src={membership.fileUrl} className="h-[90vh] w-full border-0 print:h-screen" title={membership.fileName} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={membership.fileUrl} alt={membership.fileName} className="mx-auto max-w-full" />
      )}
    </div>
  )
}
