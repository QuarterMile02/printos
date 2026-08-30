import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { FORM_TYPES } from '../constants'
import type { FormFieldSettingRow } from '../actions'
import FormFieldsClient from './form-fields-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; formType: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('forms-settings-detail', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, formType } = await params
  const meta = FORM_TYPES.find((f) => f.key === formType)
  if (!meta) notFound()

  const supabase = await createClient()
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const fields = await dbOrThrow(
    supabase
      .from('form_field_settings')
      .select('id, field_key, field_label, is_visible, is_required, sort_order')
      .eq('organization_id', org.id)
      .eq('form_type', formType)
      .order('sort_order')
  ) as FormFieldSettingRow[] ?? []

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/forms`} className="hover:text-gray-700">Forms</Link>
        <span>/</span>
        <span className="text-gray-700">{meta.label}</span>
      </div>

      <FormFieldsClient
        orgId={org.id}
        orgSlug={slug}
        formType={formType}
        formLabel={meta.label}
        initialFields={fields}
      />
    </div>
  )
}
