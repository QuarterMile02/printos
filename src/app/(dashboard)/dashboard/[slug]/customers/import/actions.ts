'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'
import type { CustomerImportRow } from '@/lib/customer-import-mapper'

export type ImportBatchResult = {
  imported: number
  skipped: number
  errors: { row: number; name: string; message: string }[]
}

export async function importCustomersBatch(
  orgId: string,
  orgSlug: string,
  rows: CustomerImportRow[],
  startRowNumber: number,
): Promise<{ error?: string; result?: ImportBatchResult }> {
  if (rows.length === 0) {
    return { result: { imported: 0, skipped: 0, errors: [] } }
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  // We use createServiceClient below to bypass RLS so first_name/last_name may
  // be empty strings for company-only rows. Because RLS is bypassed, auth and
  // permission must be checked explicitly here before any DB write.
  //
  // Step (a): verify the caller is authenticated.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  // Step (b): verify the caller is a member of this specific org with
  // sufficient role to create customers. checkPermission resolves via the
  // profiles table (role + hasPermission) and falls back to organization_members
  // for the supplied orgId if no profile row exists.
  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to create customers.' }

  // ─────────────────────────────────────────────────────────────────────────
  const service = createServiceClient()
  const result: ImportBatchResult = { imported: 0, skipped: 0, errors: [] }

  // ── 1. Validate: each row needs at least one identifying field ────────────
  const cleaned: { row: CustomerImportRow; csvRow: number; displayName: string }[] = []
  rows.forEach((r, i) => {
    const csvRow = startRowNumber + i
    if (!r.company_name && !r.first_name && !r.last_name) {
      result.errors.push({ row: csvRow, name: '(blank)', message: 'No company name or contact name — skipped.' })
      return
    }
    const displayName = r.company_name ?? [r.first_name, r.last_name].filter(Boolean).join(' ')
    cleaned.push({ row: r, csvRow, displayName })
  })
  if (cleaned.length === 0) return { result }

  // ── 2. Dedup: email-first, company-name fallback ──────────────────────────
  // Rows that have an email → match by email (case-insensitive).
  // Rows with no email but a company name → match by company name (case-insensitive).
  // Rows with neither → no unique key; always insert.
  const skipSet = new Set<number>() // indices into `cleaned`

  const emailRows = cleaned.filter((c) => c.row.email)
  if (emailRows.length > 0) {
    const emails = emailRows.map((c) => c.row.email as string)

    const { data: exact } = await service
      .from('customers')
      .select('email')
      .eq('organization_id', orgId)
      .in('email', emails) as { data: { email: string }[] | null }

    const existingLower = new Set((exact ?? []).map((r) => r.email?.toLowerCase()))

    // ilike pass for emails not caught by the case-sensitive IN
    const missed = emails.filter((e) => !existingLower.has(e.toLowerCase()))
    if (missed.length > 0) {
      const { data: ci } = await service
        .from('customers')
        .select('email')
        .eq('organization_id', orgId)
        .or(missed.map((e) => `email.ilike.${e}`).join(',')) as { data: { email: string }[] | null }
      for (const r of ci ?? []) existingLower.add(r.email?.toLowerCase())
    }

    for (const c of emailRows) {
      if (existingLower.has(c.row.email!.toLowerCase())) {
        skipSet.add(cleaned.indexOf(c))
        result.skipped++
      }
    }
  }

  const companyRows = cleaned.filter((c) => !c.row.email && c.row.company_name)
  if (companyRows.length > 0) {
    const names = companyRows.map((c) => c.row.company_name as string)

    const { data: exact } = await service
      .from('customers')
      .select('company_name')
      .eq('organization_id', orgId)
      .in('company_name', names) as { data: { company_name: string }[] | null }

    const existingLower = new Set((exact ?? []).map((r) => r.company_name?.toLowerCase()))

    const missed = names.filter((n) => !existingLower.has(n.toLowerCase()))
    if (missed.length > 0) {
      const { data: ci } = await service
        .from('customers')
        .select('company_name')
        .eq('organization_id', orgId)
        .or(missed.map((n) => `company_name.ilike.${n.replace(/[,()]/g, '')}`).join(',')) as { data: { company_name: string }[] | null }
      for (const r of ci ?? []) existingLower.add(r.company_name?.toLowerCase())
    }

    for (const c of companyRows) {
      if (existingLower.has(c.row.company_name!.toLowerCase())) {
        skipSet.add(cleaned.indexOf(c))
        result.skipped++
      }
    }
  }

  // ── 3. Build insert records ───────────────────────────────────────────────
  const toInsert = cleaned.filter((_, idx) => !skipSet.has(idx))
  if (toInsert.length === 0) return { result }

  // DIAGNOSTIC — remove after confirming city/state bug
  const firstRow = toInsert[0]?.row
  console.log('[IMPORT DIAG] rows[0] as received from client (buildRow output):', JSON.stringify({
    company_name: firstRow?.company_name,
    email: firstRow?.email,
    city: firstRow?.city,
    state: firstRow?.state,
  }))

  const records = toInsert.map(({ row }) => ({
    organization_id: orgId,
    company_name: row.company_name,
    // first_name/last_name default to '' for company-only rows — the
    // application form requires both, but the service client bypasses that
    // check so company-only imports succeed.
    first_name: row.first_name ?? '',
    last_name: row.last_name ?? '',
    email: row.email,
    phone: row.phone,
    phone2: row.phone2,
    phone_ext: row.phone_ext,
    website: row.website,
    street: row.street,
    street2: row.street2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country ?? 'US',
    status: row.status,
    industry: row.industry,
    lead_source: row.lead_source,
    pricing_level: row.pricing_level,
    terms: row.terms,
    credit_limit: row.credit_limit,
    taxable: row.taxable,
    tags: row.tags,
    notes: row.notes,
    background_info: row.background_info,
    special_notes: row.special_notes,
    ap_contact: row.ap_contact,
    tax_exempt_code: row.tax_exempt_code,
    tax_rate: row.tax_rate,
    vat_number: row.vat_number,
  }))

  // DIAGNOSTIC — remove after confirming city/state bug
  console.log('[IMPORT DIAG] records[0] right before Supabase insert:', JSON.stringify({
    company_name: records[0]?.company_name,
    email: records[0]?.email,
    city: records[0]?.city,
    state: records[0]?.state,
  }))

  // ── 4. Bulk insert with per-row fallback on failure ───────────────────────
  const { error: insertErr } = await service.from('customers').insert(records)
  if (insertErr) {
    for (let i = 0; i < records.length; i++) {
      const { error } = await service.from('customers').insert(records[i])
      if (error) {
        result.errors.push({
          row: toInsert[i].csvRow,
          name: toInsert[i].displayName,
          message: error.message,
        })
      } else {
        result.imported++
      }
    }
  } else {
    result.imported = records.length
  }

  return { result }
}

export async function revalidateCustomersList(orgSlug: string): Promise<void> {
  revalidatePath(`/dashboard/${orgSlug}/customers`)
}
