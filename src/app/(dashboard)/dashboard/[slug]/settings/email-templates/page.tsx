import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import { dbOrThrow, DbError } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import EmailTemplatesListClient, { type EmailTemplateRow } from './email-templates-list-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('email-templates', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  // Same pattern as Modifiers/Discounts/etc: these all depend only on
  // org.id, run together instead of chaining sequential awaits.
  type MemberRow = { user_id: string; role: string }
  const [userResult, memberRows, rowsData, countRes] = await Promise.all([
    supabase.auth.getUser(),
    dbOrThrow(
      supabase.from('organization_members').select('user_id, role').eq('organization_id', org.id)
    ) as Promise<MemberRow[] | null>,
    dbOrThrow(
      supabase
        .from('email_templates')
        .select('id, name, subject, trigger_event, is_active, department, ai_personalize')
        .eq('organization_id', org.id)
        .order('name', { ascending: true })
        .limit(1000)
    ) as Promise<(Omit<EmailTemplateRow, 'department'> & { department: string[] | null })[] | null>,
    supabase
      .from('email_templates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  if (countRes.error) throw new DbError(countRes.error)
  const userId = userResult.data.user?.id ?? ''
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'
  const totalCount = countRes.count ?? 0

  // department is text[] NOT NULL DEFAULT '{}' per migration 116, but that
  // migration hasn't run in production yet (as of this writing the live
  // column is still the scalar `text` migration 115 shipped) — normalize
  // defensively rather than assuming the migration has landed; this is a
  // harmless no-op once it has.
  const templates: EmailTemplateRow[] = (rowsData ?? []).map(t => ({
    ...t,
    department: Array.isArray(t.department) ? t.department : t.department ? [t.department] : [],
  }))

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Email Templates</span>
      </div>

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      <EmailTemplatesListClient
        orgId={org.id}
        orgSlug={slug}
        userId={userId}
        userRole={userRole}
        initialTemplates={templates}
      />
    </div>
  )
}
