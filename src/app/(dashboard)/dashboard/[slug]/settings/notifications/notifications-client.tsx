'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { updateNotificationSetting } from './actions'

const EVENT_GROUPS = [
  {
    group: 'Quotes',
    events: ['Created', 'Status Changed', 'Review Viewed by Customer', 'Review Approved', 'New Comment on Review', 'New Review', 'Voided'],
  },
  {
    group: 'Sales Orders',
    events: ['Created', 'Completed', 'Voided', 'Note Created'],
  },
  {
    group: 'Jobs',
    events: ['Created', 'Completed', 'Proof Uploaded', 'Proof Approved', 'Proof Commented', 'Proof Viewed by Contact', 'Rush Job Created', 'State Changed', 'Priority Changed', 'Due Date Changed', 'Note Created', 'Job Step Completed', 'Job Step Assignee Changed', 'Voided'],
  },
  {
    group: 'Invoices',
    events: ['Created', 'Voided'],
  },
  {
    group: 'Payments',
    events: ['Contact Made Payment', 'Payment Created', 'Payment Updated', 'Payment Voided'],
  },
  {
    group: 'Purchase Orders',
    events: ['Created', 'Voided'],
  },
  {
    group: 'Customers',
    events: ['Created', 'Saved'],
  },
  {
    group: 'Tasks',
    events: ['Created', 'Completed', 'Deleted', 'Updated', 'Reminded'],
  },
  {
    group: 'Shipments',
    events: ['Created'],
  },
]

type NotifRow = {
  channel_email: boolean
  channel_sms: boolean
  channel_inapp: boolean
  notify_sales_rep: boolean
  notify_production_manager: boolean
  notify_assignee: boolean
  notify_designer: boolean
  notify_roles: string[]
}

const DEFAULT_ROW: NotifRow = {
  channel_email: false,
  channel_sms: false,
  channel_inapp: true,
  notify_sales_rep: false,
  notify_production_manager: false,
  notify_assignee: false,
  notify_designer: false,
  notify_roles: [],
}

type DbRow = { event_group: string; event_name: string } & Partial<NotifRow>

type Props = {
  orgId: string
  orgSlug: string
  initialSettings: DbRow[]
}

const LINKED_ROLES: [keyof Pick<NotifRow, 'notify_sales_rep' | 'notify_production_manager' | 'notify_assignee' | 'notify_designer'>, string][] = [
  ['notify_sales_rep', 'Sales Rep'],
  ['notify_production_manager', 'Production Manager'],
  ['notify_assignee', 'Assignee'],
  ['notify_designer', 'Designer'],
]

const ROLE_OPTIONS: [string, string][] = [
  ['owner', 'Owner / Admin'],
  ['member', 'Sales'],
  ['production', 'Production'],
  ['super_user', 'Super User'],
]

export default function NotificationsClient({ orgId, orgSlug, initialSettings }: Props) {
  const [settings, setSettings] = useState<Record<string, NotifRow>>(() => {
    const map: Record<string, NotifRow> = {}
    for (const row of initialSettings) {
      map[`${row.event_group}:${row.event_name}`] = { ...DEFAULT_ROW, ...row }
    }
    return map
  })

  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(EVENT_GROUPS.map((g) => g.group)),
  )
  const [openNotifyKey, setOpenNotifyKey] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const notifyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openNotifyKey) return
    function handle(e: MouseEvent) {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) {
        setOpenNotifyKey(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [openNotifyKey])

  function getRow(group: string, event: string): NotifRow {
    return settings[`${group}:${event}`] ?? { ...DEFAULT_ROW }
  }

  function applyPatch(group: string, event: string, patch: Partial<NotifRow>) {
    const key = `${group}:${event}`
    setSettings((prev) => ({ ...prev, [key]: { ...(prev[key] ?? DEFAULT_ROW), ...patch } }))
    startTransition(async () => {
      await updateNotificationSetting(orgId, orgSlug, group, event, patch)
    })
  }

  function toggleChannel(group: string, event: string, field: 'channel_email' | 'channel_sms' | 'channel_inapp') {
    applyPatch(group, event, { [field]: !getRow(group, event)[field] })
  }

  function toggleLinkedRole(group: string, event: string, field: keyof Pick<NotifRow, 'notify_sales_rep' | 'notify_production_manager' | 'notify_assignee' | 'notify_designer'>) {
    applyPatch(group, event, { [field]: !getRow(group, event)[field] })
  }

  function toggleRole(group: string, event: string, role: string) {
    const current = getRow(group, event).notify_roles ?? []
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
    applyPatch(group, event, { notify_roles: next })
  }

  function notifyCount(row: NotifRow): number {
    return (
      (row.notify_sales_rep ? 1 : 0) +
      (row.notify_production_manager ? 1 : 0) +
      (row.notify_assignee ? 1 : 0) +
      (row.notify_designer ? 1 : 0) +
      (row.notify_roles?.length ?? 0)
    )
  }

  return (
    <div className="space-y-4">
      {EVENT_GROUPS.map(({ group, events }) => {
        const isOpen = openSections.has(group)
        return (
          <div key={group} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Section header */}
            <button
              type="button"
              onClick={() =>
                setOpenSections((prev) => {
                  const next = new Set(prev)
                  if (next.has(group)) next.delete(group)
                  else next.add(group)
                  return next
                })
              }
              className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <span className="text-sm font-bold uppercase tracking-wider text-gray-700">{group}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{events.length} event{events.length !== 1 ? 's' : ''}</span>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100">
                {/* Column headers */}
                <div className="flex items-center px-5 py-2 text-xs font-medium uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <span className="flex-1">Event</span>
                  <div className="flex items-center gap-1">
                    <span className="w-14 text-center">Email</span>
                    <span className="w-10 text-center">SMS</span>
                    <span className="w-14 text-center">In-App</span>
                    <span className="w-20 text-center">Notify</span>
                  </div>
                </div>

                {/* Event rows */}
                {events.map((event) => {
                  const key = `${group}:${event}`
                  const row = getRow(group, event)
                  const nc = notifyCount(row)
                  const isNotifyOpen = openNotifyKey === key

                  return (
                    <div
                      key={event}
                      className="flex items-center px-5 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60 relative"
                    >
                      <span className="flex-1 text-sm text-gray-700">{event}</span>

                      <div className="flex items-center gap-1">
                        {/* Email */}
                        <div className="w-14 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleChannel(group, event, 'channel_email')}
                            title={row.channel_email ? 'Email on' : 'Email off'}
                            className={`rounded-md p-1.5 transition-colors ${
                              row.channel_email
                                ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200'
                                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                            </svg>
                          </button>
                        </div>

                        {/* SMS */}
                        <div className="w-10 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleChannel(group, event, 'channel_sms')}
                            title={row.channel_sms ? 'SMS on' : 'SMS off'}
                            className={`rounded-md p-1.5 transition-colors ${
                              row.channel_sms
                                ? 'bg-green-50 text-green-600 ring-1 ring-green-200'
                                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
                            </svg>
                          </button>
                        </div>

                        {/* In-App */}
                        <div className="w-14 flex justify-center">
                          <button
                            type="button"
                            onClick={() => toggleChannel(group, event, 'channel_inapp')}
                            title={row.channel_inapp ? 'In-App on' : 'In-App off'}
                            className={`rounded-md p-1.5 transition-colors ${
                              row.channel_inapp
                                ? 'bg-purple-50 text-purple-600 ring-1 ring-purple-200'
                                : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                            </svg>
                          </button>
                        </div>

                        {/* Notify dropdown */}
                        <div
                          className="w-20 flex justify-center relative"
                          ref={isNotifyOpen ? notifyRef : undefined}
                        >
                          <button
                            type="button"
                            onClick={() => setOpenNotifyKey(isNotifyOpen ? null : key)}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                              nc > 0
                                ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700'
                                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            {nc > 0 ? `${nc} role${nc === 1 ? '' : 's'}` : 'Notify'}
                            <svg
                              className={`h-3 w-3 transition-transform ${isNotifyOpen ? 'rotate-180' : ''}`}
                              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                          </button>

                          {isNotifyOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-gray-200 bg-white shadow-xl">
                              <div className="p-3 space-y-3">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Linked Roles</p>
                                  <div className="space-y-1.5">
                                    {LINKED_ROLES.map(([field, label]) => (
                                      <label key={field} className="flex items-center gap-2 cursor-pointer group/chk">
                                        <input
                                          type="checkbox"
                                          checked={row[field]}
                                          onChange={() => toggleLinkedRole(group, event, field)}
                                          className="h-3.5 w-3.5 accent-qm-lime"
                                        />
                                        <span className="text-xs text-gray-700 group-hover/chk:text-gray-900">{label}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div className="border-t border-gray-100 pt-2.5">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Role-Based</p>
                                  <div className="space-y-1.5">
                                    {ROLE_OPTIONS.map(([role, label]) => (
                                      <label key={role} className="flex items-center gap-2 cursor-pointer group/chk">
                                        <input
                                          type="checkbox"
                                          checked={(row.notify_roles ?? []).includes(role)}
                                          onChange={() => toggleRole(group, event, role)}
                                          className="h-3.5 w-3.5 accent-qm-lime"
                                        />
                                        <span className="text-xs text-gray-700 group-hover/chk:text-gray-900">{label}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
