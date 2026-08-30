'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function isOwnerOrAdmin(orgId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null }
  return data?.role === 'owner' || data?.role === 'admin'
}

// Deletes a Customer Portal login entirely -- the rare, deliberate action
// (build plan rev. 2, step 4), distinct from the per-customer "Revoke
// Portal Access" already on the customer detail page. This is a property
// of the PERSON, not any single customer relationship, which is exactly
// why it only lives here and nowhere on the customer page itself.
export async function deletePortalLogin(
  portalUserId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  if (!(await isOwnerOrAdmin(orgId))) {
    return { error: 'You do not have permission to delete portal logins.' }
  }

  const service = createServiceClient()

  // Defense-in-depth, not paranoia: confirm every customer_contacts row
  // carrying this portal_user_id actually belongs to THIS org before
  // deleting the underlying auth.users row. In practice a portal_user_id
  // can never span two different orgs -- acceptInvite()'s
  // admin.createUser() enforces a globally-unique email across the whole
  // Supabase project, and sendPortalInvite()'s reuse-link check is scoped
  // to organization_id, so an account only ever gets reused within the
  // org that first created it -- but this is real account deletion, and
  // the check is one cheap query.
  const { data: rows, error: rowsErr } = await service
    .from('customer_contacts')
    .select('id, organization_id')
    .eq('portal_user_id', portalUserId)
  if (rowsErr) return { error: rowsErr.message }
  if (!rows || rows.length === 0) return { error: 'No matching portal login found.' }
  if (rows.some((r) => r.organization_id !== orgId)) {
    return { error: 'This login has relationships outside this organization -- cannot delete from here.' }
  }

  const { error } = await service.auth.admin.deleteUser(portalUserId)
  if (error) return { error: error.message }
  // ON DELETE SET NULL on customer_contacts.portal_user_id (migration 134)
  // cascades correctly -- every row above gets portal_user_id set back to
  // null automatically, no manual per-row cleanup needed here.

  revalidatePath(`/dashboard/${orgSlug}/settings/portal-accounts`)
  return {}
}
