import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { generateQRDataUrl } from '@/lib/qr'
import { renderToBuffer } from '@react-pdf/renderer'
import JobLabelsDocument, { type JobLabelData } from '@/lib/pdf/job-label'
import React from 'react'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const service = createServiceClient()

    type JobRow = {
      id: string
      job_number: number
      title: string
      due_date: string | null
      assigned_printer: string | null
      organization_id: string
      organizations: { slug: string } | null
      customers: { first_name: string; last_name: string; company_name: string | null } | null
    }
    const { data: jobRow } = await service
      .from('jobs')
      .select('id, job_number, title, due_date, assigned_printer, organization_id, organizations(slug), customers(first_name, last_name, company_name)')
      .eq('id', id)
      .maybeSingle() as { data: JobRow | null; error: unknown }

    if (!jobRow) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const { allowed } = await checkPermission(jobRow.organization_id, 'jobs.print_label')
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const orgSlug = jobRow.organizations?.slug ?? ''
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://printos-lemon.vercel.app'
    const jobUrl = `${appUrl}/dashboard/${orgSlug}/jobs/${id}`
    const qrDataUrl = await generateQRDataUrl(jobUrl)

    const c = jobRow.customers
    const customerName = c
      ? (c.company_name || `${c.first_name} ${c.last_name}`.trim())
      : 'Unknown Customer'

    const label: JobLabelData = {
      jobNumber: `JOB-${String(jobRow.job_number).padStart(4, '0')}`,
      customerName,
      dueDate: jobRow.due_date
        ? new Date(jobRow.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null,
      department: null,
      printer: jobRow.assigned_printer,
      qrDataUrl,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(JobLabelsDocument as any, { labels: [label] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await (renderToBuffer as any)(element)

    const filename = `Label-JOB-${String(jobRow.job_number).padStart(4, '0')}.pdf`
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/jobs/[id]/label] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
