'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { STAFF_DEPARTMENTS } from '@/lib/staff-departments'
import { cloneEmailTemplate } from './actions'

export type EmailTemplateRow = {
  id: string
  name: string
  subject: string
  trigger_event: string | null
  is_active: boolean | null
  department: string[]
  ai_personalize: boolean | null
}

type Props = {
  orgId: string
  orgSlug: string
  userId: string
  userRole: string
  initialTemplates: EmailTemplateRow[]
}

const EVENT_LABELS: Record<string, string> = {
  manual: 'Manual only',
  quote_sent: 'Quote Sent', quote_revised: 'Quote Revised', quote_reminder: 'Quote Reminder',
  proof_sent: 'Proof Sent', proof_reminder: 'Proof Reminder', proof_revised: 'Proof Revised',
  order_confirmed: 'Order Confirmed', order_ready: 'Order Ready', invoice_sent: 'Invoice Sent',
  payment_reminder: 'Payment Reminder', permit_required: 'Permit Required', deposit_received: 'Deposit Received',
  job_complete: 'Job Complete', statement: 'Statement', purchase_order: 'Purchase Order', appointment: 'Appointment',
}

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

const DEPT_LABEL = new Map(STAFF_DEPARTMENTS.map(d => [d.value as string, d.label]))
function deptLabel(v: string) { return DEPT_LABEL.get(v) ?? v }

type DeptTab = 'all' | 'unassigned' | string

export default function EmailTemplatesListClient({ orgId, orgSlug, userId, userRole, initialTemplates }: Props) {
  const [templates] = useState<EmailTemplateRow[]>(initialTemplates)
  const [search, setSearch] = useState('')
  const [deptTab, setDeptTab] = useState<DeptTab>('all')

  const {
    sortRules, filterRules, columnWidths: savedWidths, viewMode,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, setViewMode, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'email_templates', orgId, userId, userRole })
  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // Department tab acts as an override on top of the saved-view's own
  // filterRules, same composition pattern as the Enabled/Disabled/All tabs
  // on Discounts — strip any rule already on `department` and inject the
  // tab's constraint. `department` is a text[] column; getValue below joins
  // it into a string, so "contains" (the default operator new filter rules
  // start with) does substring/membership matching, and "is_empty" catches
  // the unassigned case (joined string of an empty array is '').
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    const base = filterRules.filter(r => r.column !== 'department')
    if (deptTab === 'all') return base
    if (deptTab === 'unassigned') return [...base, { id: '__dept_tab__', column: 'department', operator: 'is_empty' as const, value: '' }]
    return [...base, { id: '__dept_tab__', column: 'department', operator: 'contains' as const, value: deptTab }]
  }, [filterRules, deptTab])

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: templates.length, unassigned: templates.filter(t => t.department.length === 0).length }
    for (const d of STAFF_DEPARTMENTS) counts[d.value] = templates.filter(t => t.department.includes(d.value)).length
    return counts
  }, [templates])

  const COLUMNS = useMemo((): ColumnDef<EmailTemplateRow>[] => [
    { key: 'name', label: 'Name', defaultWidth: 220, sortable: true, filterable: true, filterType: 'text', getValue: (t) => t.name },
    {
      key: 'department', label: 'Department', defaultWidth: 200, sortable: false, filterable: true, filterType: 'select',
      filterOptions: STAFF_DEPARTMENTS.map(d => ({ label: d.label, value: d.value })),
      getValue: (t) => t.department.map(deptLabel).join(', '),
    },
    {
      key: 'trigger_event', label: 'Trigger Event', defaultWidth: 170, sortable: true, filterable: true, filterType: 'select',
      filterOptions: Object.entries(EVENT_LABELS).map(([value, label]) => ({ label, value })),
      getValue: (t) => t.trigger_event ?? 'manual',
    },
    { key: 'subject', label: 'Subject', defaultWidth: 260, sortable: false, filterable: true, filterType: 'text', getValue: (t) => t.subject },
    {
      key: 'ai_personalize', label: 'AI', defaultWidth: 90, sortable: false, filterable: true, filterType: 'select',
      filterOptions: [{ label: 'On', value: 'true' }, { label: 'Off', value: 'false' }],
      getValue: (t) => t.ai_personalize ? 'true' : 'false',
    },
    {
      key: 'is_active', label: 'Active', defaultWidth: 100, sortable: true, filterable: true, filterType: 'select',
      filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      getValue: (t) => t.is_active !== false ? 'true' : 'false',
    },
    { key: 'actions', label: 'Actions', defaultWidth: 110, sortable: false, filterable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  function SortIcon({ column }: { column: string }) {
    const rule = activeSortRules.find((r) => r.column === column)
    if (rule?.direction === 'asc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" /></svg>
    if (rule?.direction === 'desc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
    return <svg className="h-3 w-3 opacity-20" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0)

  const filtered = useMemo(() => {
    const byRules = applyFilterRules(templates, effectiveFilterRules, COLUMNS)
    const term = search.trim().toLowerCase()
    const searched = term ? byRules.filter((t) => `${t.name} ${t.subject}`.toLowerCase().includes(term)) : byRules
    return applySortRules(searched, activeSortRules, COLUMNS)
  }, [templates, search, effectiveFilterRules, activeSortRules, COLUMNS])

  return (
    <>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Email Templates <span className="text-sm font-normal text-gray-400">({templates.length})</span></h1>
        </div>
        <Link href={`/dashboard/${orgSlug}/settings/email-templates/new`} className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Template
        </Link>
      </div>

      {/* Department quick-filter tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDeptTab('all')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${deptTab === 'all' ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
        >
          All <span className="ml-1.5 text-xs text-qm-gray">({tabCounts.all})</span>
        </button>
        <button
          type="button"
          onClick={() => setDeptTab('unassigned')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${deptTab === 'unassigned' ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
        >
          Unassigned <span className="ml-1.5 text-xs text-qm-gray">({tabCounts.unassigned})</span>
        </button>
        {STAFF_DEPARTMENTS.map(d => (
          <button
            key={d.value}
            type="button"
            onClick={() => setDeptTab(d.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${deptTab === d.value ? 'bg-qm-lime-light text-qm-lime' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
          >
            {d.label} <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[d.value] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Search + Filters/Views toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or subject..." className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
        </div>
        <div className="ml-auto">
          <DataTableToolbar
            columns={COLUMNS}
            filterRules={filterRules}
            onFilterRulesChange={setFilterRules}
            activeView={activeView}
            myViews={myViews}
            sharedViews={sharedViews}
            isDirty={isDirty}
            isViewReadOnly={isViewReadOnly}
            viewsLoading={viewsLoading}
            currentUserId={userId}
            onLoadView={loadView}
            onSaveView={saveCurrentView}
            onCreateView={createView}
            onDeleteView={deleteView}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
      </div>

      {/* Table / Cards */}
      {viewMode === 'card' ? (
        templates.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <NoMatchState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => <TemplateCard key={t.id} template={t} orgSlug={orgSlug} />)}
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="divide-y divide-gray-200 table-fixed" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {COLUMNS.map((col) => <col key={col.key} style={{ width: colWidths[col.key] ?? col.defaultWidth }} />)}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {COLUMNS.map((col, i) => {
                  const isSortable = col.sortable && !isViewReadOnly
                  const isLast = i === COLUMNS.length - 1
                  const isActions = col.key === 'actions'
                  const isCenter = col.key === 'ai_personalize' || col.key === 'is_active'
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-6 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isActions ? `text-right ${STICKY_ACTIONS_TH}` : isCenter ? 'text-center' : 'text-left'}`}
                    >
                      <div className={`flex items-center gap-1 ${isActions ? 'justify-end' : isCenter ? 'justify-center' : ''}`}>
                        {col.label}
                        {col.sortable && <SortIcon column={col.key} />}
                      </div>
                      {!isLast && col.resizable !== false && (
                        <div onMouseDown={(e) => startResize(col.key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-qm-lime hover:opacity-30 z-10" />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templates.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} className="px-6 py-16 text-center"><EmptyState inline /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLUMNS.length} className="px-6 py-12 text-center"><NoMatchState inline /></td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} className="group hover:bg-gray-50">
                  <td className="overflow-hidden px-6 py-3">
                    <Link href={`/dashboard/${orgSlug}/settings/email-templates/${t.id}`} className="block truncate text-sm font-semibold text-gray-900 hover:text-qm-fuchsia">
                      {t.name}
                    </Link>
                  </td>
                  <td className="overflow-hidden px-6 py-3">
                    {t.department.length === 0 ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {t.department.map(d => (
                          <span key={d} className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap">{deptLabel(d)}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="overflow-hidden px-6 py-3 text-sm text-gray-600">
                    <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 whitespace-nowrap">
                      {EVENT_LABELS[t.trigger_event ?? 'manual'] ?? t.trigger_event}
                    </span>
                  </td>
                  <td className="overflow-hidden px-6 py-3 text-sm text-gray-500"><span className="block truncate">{t.subject}</span></td>
                  <td className="whitespace-nowrap px-6 py-3 text-center">
                    {t.ai_personalize && (
                      <span className="inline-block rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700" title="AI-personalize per order is on">AI</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${t.is_active !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className={`whitespace-nowrap px-6 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                    <div className="inline-flex items-center gap-3">
                      <form action={cloneEmailTemplate} className="inline">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <button type="submit" className="text-sm font-medium text-gray-500 hover:text-gray-800">Clone</button>
                      </form>
                      <Link href={`/dashboard/${orgSlug}/settings/email-templates/${t.id}?edit=1`} className="text-sm font-medium text-qm-lime hover:underline">Edit</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            Showing {filtered.length} of {templates.length} templates
          </div>
        </div>
      )}
    </>
  )
}

function EmptyState({ inline }: { inline?: boolean }) {
  const body = (
    <>
      <p className="text-sm font-medium text-gray-900">No email templates yet</p>
      <p className="mt-1 text-sm text-gray-500">Create your first template to get started.</p>
    </>
  )
  if (inline) return body
  return <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">{body}</div>
}

function NoMatchState({ inline }: { inline?: boolean }) {
  const body = <p className="text-sm text-qm-gray">No templates match your filters.</p>
  if (inline) return body
  return <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">{body}</div>
}

function TemplateCard({ template, orgSlug }: { template: EmailTemplateRow; orgSlug: string }) {
  return (
    <Link
      href={`/dashboard/${orgSlug}/settings/email-templates/${template.id}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime/40 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full mt-1 ${template.is_active !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
      </div>
      <p className="mt-1 text-xs text-gray-500 truncate">{template.subject}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          {EVENT_LABELS[template.trigger_event ?? 'manual'] ?? template.trigger_event}
        </span>
        {template.ai_personalize && (
          <span className="inline-block rounded-full bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">AI</span>
        )}
        {template.department.map(d => (
          <span key={d} className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{deptLabel(d)}</span>
        ))}
      </div>
    </Link>
  )
}
