'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { SavedView } from './types'
import type { CreateViewParams } from './use-saved-view'
import { usePortalPanel } from './use-portal-panel'

const ORG_ROLES = ['owner', 'sales', 'designer', 'production', 'installer', 'digital', 'accounting']

const VIEW_TYPE_BADGE: Record<string, string> = {
  personal:      'bg-gray-100 text-gray-500',
  collaborative: 'bg-blue-50 text-blue-600',
  locked:        'bg-amber-50 text-amber-700',
}
const VIEW_TYPE_LABEL: Record<string, string> = {
  personal:      'Personal',
  collaborative: 'Collab',
  locked:        'Locked',
}

interface Props {
  activeView: SavedView | null
  myViews: SavedView[]
  sharedViews: SavedView[]
  isDirty: boolean
  isViewReadOnly: boolean
  loading: boolean
  currentUserId: string
  onLoad: (view: SavedView | null) => void
  onSave: () => Promise<{ error?: string } | void>
  onCreate: (params: CreateViewParams) => Promise<{ error?: string }>
  onDelete: (id: string) => Promise<{ error?: string }>
}

export function ViewsDropdown({
  activeView, myViews, sharedViews, isDirty, isViewReadOnly,
  loading, onLoad, onSave, onCreate, onDelete,
}: Props) {
  const { open, setOpen, mounted, triggerRef, panelRef, pos } = usePortalPanel()

  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'personal' | 'collaborative' | 'locked'>('personal')
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Reset create form when panel closes
  useEffect(() => {
    if (!open) setShowCreate(false)
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    await onSave()
    setSaving(false)
  }

  const handleCreate = async () => {
    if (!newName.trim()) { setCreateError('Name is required'); return }
    setCreating(true)
    setCreateError('')
    const { error } = await onCreate({
      name: newName.trim(),
      viewType: newType,
      sharedWithRoles: selectedRoles,
      sharedWithUserIds: [],
    })
    setCreating(false)
    if (error) { setCreateError(error); return }
    setNewName('')
    setNewType('personal')
    setSelectedRoles([])
    setShowCreate(false)
    setOpen(false)
  }

  const toggleRole = (role: string) =>
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )

  const buttonLabel = activeView?.name ?? 'Views'

  return (
    <div>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
          activeView
            ? 'border-qm-lime bg-qm-lime-light text-qm-lime-dark'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {/* list icon */}
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
        </svg>
        <span className="max-w-[130px] truncate">{buttonLabel}</span>
        {/* dirty indicator dot */}
        {isDirty && !isViewReadOnly && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        )}
        <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* ── Panel — portaled to document.body so no ancestor overflow clips it ── */}
      {mounted && open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400">Loading views…</div>
          ) : showCreate ? (
            /* ── Create view form ── */
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">New View</span>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded p-1 text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <input
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Active banners"
                  className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as typeof newType)}
                  className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                >
                  <option value="personal">Personal — only you</option>
                  <option value="collaborative">Collaborative — shared, editable</option>
                  <option value="locked">Locked — shared, read-only</option>
                </select>
              </div>

              {newType !== 'personal' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-600">
                    Share with roles
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ORG_ROLES.map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleRole(role)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                          selectedRoles.includes(role)
                            ? 'border-qm-lime bg-qm-lime text-white'
                            : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {createError && (
                <p className="text-xs text-red-600">{createError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {creating ? 'Saving…' : 'Save View'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active view bar */}
              {activeView && (
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
                  <span className="truncate text-xs text-gray-500">
                    <strong className="text-gray-700">{activeView.name}</strong>
                    {isViewReadOnly && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Read-only
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {isDirty && !isViewReadOnly && (
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded bg-qm-lime px-2 py-1 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { onLoad(null); setOpen(false) }}
                      title="Clear view"
                      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* My Views */}
              {myViews.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    My Views
                  </div>
                  {myViews.map((view) => (
                    <div key={view.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => { onLoad(view); setOpen(false) }}
                        className={`flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                          activeView?.id === view.id ? 'font-medium text-qm-lime-dark' : 'text-gray-700'
                        }`}
                      >
                        {activeView?.id === view.id ? (
                          <svg className="h-3.5 w-3.5 shrink-0 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="flex-1 truncate">{view.name}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VIEW_TYPE_BADGE[view.view_type] ?? ''}`}>
                          {VIEW_TYPE_LABEL[view.view_type] ?? view.view_type}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(view.id)}
                        title="Delete view"
                        className="mr-2 hidden rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 group-hover:flex"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Shared Views */}
              {sharedViews.length > 0 && (
                <div className={`py-1 ${myViews.length > 0 ? 'border-t border-gray-100' : ''}`}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Shared Views
                  </div>
                  {sharedViews.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => { onLoad(view); setOpen(false) }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                        activeView?.id === view.id ? 'font-medium text-qm-lime-dark' : 'text-gray-700'
                      }`}
                    >
                      {activeView?.id === view.id ? (
                        <svg className="h-3.5 w-3.5 shrink-0 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="flex-1 truncate">{view.name}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VIEW_TYPE_BADGE[view.view_type] ?? ''}`}>
                        {VIEW_TYPE_LABEL[view.view_type] ?? view.view_type}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {myViews.length === 0 && sharedViews.length === 0 && (
                <div className="px-4 py-4 text-center text-xs text-gray-400">
                  No saved views yet.
                </div>
              )}

              {/* Add New View */}
              <div className="border-t border-gray-100 p-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-qm-lime transition-colors hover:bg-qm-lime-light"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add New View
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
