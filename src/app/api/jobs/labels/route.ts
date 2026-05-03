import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { generateQRDataUrl } from '@/lib/qr'
import { renderToBuffer } from '@react-pdf/renderer'
import JobLabelsDocument, { type JobLabelData } from '@/lib/pdf/job-label'
import React from 'react'

export const dynamic = 'force-dynamic'

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

const SELECT = 'id, job_number, title, due_date, assigned_printer, organization_id, organizations(slug), customers(first_name, last_name, company_name)'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const idsParam   = searchParams.get('ids')
    const orgId      = searchParams.get('org')
    const since      = searchParams.get('since')

    const service = createServiceClient()
    let jobs: JobRow[] = []

    if (idsParam) {
      // Mode 1: specific job IDs (kanban multi-select)
      const ids = idsParam.split(',').filter(Boolean).slice(0, 50)
      if (ids.length === 0) return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })

      const { data } = await service
        .from('jobs').select(SELECT).in('id', ids) as { data: JobRow[] | null; error: unknown }
      jobs = data ?? []
      if (jobs.length === 0) return NextResponse.json({ error: 'No jobs found' }, { status: 404 })

      // All jobs must belong to the same org (prevents cross-org data leaks)
      const orgIds = new Set(jobs.map((j) => j.organization_id))
      if (orgIds.size > 1) return NextResponse.json({ error: 'Jobs must belong to the same organization' }, { status: 400 })

      const resolvedOrgId = jobs[0].organization_id
      const { allowed } = await checkPermission(resolvedOrgId, 'jobs.print_label')
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    } else if (orgId && since) {
      // Mode 2: all jobs since a date for an org (production control "today's batch")
      const { allowed } = await checkPermission(orgId, 'jobs.print_label')
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      const sinceIso = new Date(since + 'T00:00:00').toISOString()
      const { data } = await service
        .from('jobs').select(SELECT)
        .eq('organization_id', orgId)
        .gte('created_at', sinceIso)
        .order('job_number') as { data: JobRow[] | null; error: unknown }
      jobs = data ?? []
      if (jobs.length === 0) return NextResponse.json({ error: 'No jobs found for this date' }, { status: 404 })

    } else {
      return NextResponse.json({ error: 'Provide ?ids=... or ?org=...&since=...' }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://printos-lemon.vercel.app'

    const labels: JobLabelData[] = await Promise.all(
      jobs.map(async (job) => {
        const orgSlug = job.organizations?.slug ?? ''
        const qrDataUrl = await generateQRDataUrl(`${appUrl}/dashboard/${orgSlug}/jobs/${job.id}`)
        const c = job.customers
        return {
          jobNumber: `JOB-${String(job.job_number).padStart(4, '0')}`,
          customerName: c ? (c.company_name || `${c.first_name} ${c.last_name}`.trim()) : 'Unknown Customer',
          dueDate: job.due_date
            ? new Date(job.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : null,
          department: null,
          printer: job.assigned_printer,
          qrDataUrl,
        }
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(JobLabelsDocument as any, { labels })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = await (renderToBuffer as any)(element)

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Job-Labels.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[/api/jobs/labels] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
