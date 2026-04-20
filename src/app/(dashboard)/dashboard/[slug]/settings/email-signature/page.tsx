import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import EmailSignatureEditor from '@/components/email-signature-editor'
import type { SignatureFields } from '@/app/actions/email-signature'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function EmailSignaturePage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single() as { data: { id: string; name: string } | null; error: unknown }
  if (!orgRow) notFound()

  // Fetch current user's signature
  const service = createServiceClient()
  let signatureBody = ''
  let fields: SignatureFields = {
    sig_full_name: '',
    sig_title: '',
    sig_phone: '',
    sig_mobile: '',
    sig_address: '',
  }

  try {
    type SigRow = {
      body: string
      sig_full_name: string | null
      sig_title: string | null
      sig_phone: string | null
      sig_mobile: string | null
      sig_address: string | null
    }
    const { data } = await service
      .from('email_signatures')
      .select('body, sig_full_name, sig_title, sig_phone, sig_mobile, sig_address')
      .eq('user_id', user.id)
      .eq('organization_id', orgRow.id)
      .maybeSingle() as { data: SigRow | null; error: unknown }

    if (data) {
      signatureBody = data.body
      fields = {
        sig_full_name: data.sig_full_name ?? '',
        sig_title: data.sig_title ?? '',
        sig_phone: data.sig_phone ?? '',
        sig_mobile: data.sig_mobile ?? '',
        sig_address: data.sig_address ?? '',
      }
    }
  } catch {
    // Table or columns may not exist yet
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{orgRow.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Email Signature</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Email Signature</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your signature is automatically appended to all outgoing emails. Edit your contact info below &mdash; the design template is locked.
        </p>
      </div>

      {signatureBody ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <EmailSignatureEditor
            orgId={orgRow.id}
            initialFields={fields}
            initialBody={signatureBody}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          No signature has been set up for your account yet. Contact your organization owner to initialize your email signature.
        </div>
      )}
    </div>
  )
}
