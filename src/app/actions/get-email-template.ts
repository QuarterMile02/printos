'use server'

import { createClient } from '@/lib/supabase/server'

type TemplateResult = {
  name: string
  subject: string
  body: string
} | null

export async function getEmailTemplate(orgId: string, trigger: string): Promise<TemplateResult> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('email_templates')
    .select('name, subject, body')
    .eq('organization_id', orgId)
    .eq('trigger_event', trigger)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const t = data as { name: string; subject: string; body: string }
  return { name: t.name, subject: t.subject, body: t.body }
}

export async function renderTemplate(
  template: string,
  vars: Record<string, string>,
): Promise<string> {
  let result = template
  // Always inject defaults
  const merged: Record<string, string> = {
    account_name: 'Quarter Mile, Inc.',
    account_phone: '(956) 722-7690',
    account_email: 'info@quartermileinc.com',
    ...vars,
  }
  for (const [key, value] of Object.entries(merged)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}
