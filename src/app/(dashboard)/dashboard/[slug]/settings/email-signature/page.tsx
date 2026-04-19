import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import EmailSignatureEditor from '@/components/email-signature-editor'

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

  // Fetch existing signature using service client (RLS is per-user, but
  // createServiceClient bypasses it so the server component can read)
  let signatureBody = ''
  try {
    const service = createServiceClient()
    const { data } = await service
      .from('email_signatures')
      .select('body')
      .eq('user_id', user.id)
      .eq('organization_id', orgRow.id)
      .maybeSingle()

    if (data) {
      signatureBody = (data as { body: string }).body
    }
  } catch {
    // Table may not exist yet — start with empty
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
          Your signature is automatically appended to all outgoing emails.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <EmailSignatureEditor orgId={orgRow.id} initialBody={signatureBody} />
      </div>
    </div>
  )
}
