import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import { FORM_TYPES } from './constants'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('forms-settings', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const rows = await dbOrThrow(
    supabase.from('form_field_settings').select('form_type').eq('organization_id', org.id)
  ) as { form_type: string }[] ?? []
  const countByType = new Map<string, number>()
  for (const r of rows) countByType.set(r.form_type, (countByType.get(r.form_type) ?? 0) + 1)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Forms</span>
      </div>

      <SettingsPageHeader
        title="Forms"
        description="Toggle the visibility and requiredness of fields across forms in PrintOS."
      />

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {FORM_TYPES.map((f) => {
            const count = countByType.get(f.key) ?? 0
            return (
              <li key={f.key}>
                <Link
                  href={`/dashboard/${slug}/settings/forms/${f.key}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-900">{f.label}</span>
                  <span className="text-xs text-gray-400">
                    {count > 0 ? `${count} field${count === 1 ? '' : 's'} configured` : 'Not configured yet'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
