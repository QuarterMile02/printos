'use client'

import { useState, useTransition } from 'react'
import { saveContact, deleteContact, setPrimaryContact, type ContactInput } from '../actions'

type ContactRow = {
  id: string; full_name: string; first_name: string | null; last_name: string | null
  email: string | null; email2: string | null; phone: string | null
  phone2: string | null; phone_ext: string | null; title: string | null
  is_primary: boolean | null; is_ap_contact: boolean | null; is_active: boolean | null
}

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  initialContacts: ContactRow[]
  inTab?: boolean
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function emptyDraft(): ContactInput & { full_name: string } {
  return {
    full_name: '', first_name: null, last_name: null,
    email: null, email2: null, phone: null, phone2: null, phone_ext: null,
    title: null, is_primary: false, is_ap_contact: false,
  }
}

function ContactForm({
  draft, onChange, error, pending, onSave, onCancel, isNew,
}: {
  draft: ContactInput & { full_name: string }
  onChange: (d: ContactInput & { full_name: string }) => void
  error: string | null; pending: boolean
  onSave: () => void; onCancel: () => void; isNew: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
      {error && <div className="rounded-md bg-red-50 border border-red-200 p-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
          <input type="text" value={draft.full_name} onChange={(e) => onChange({ ...draft, full_name: e.target.value })} className={ic} placeholder="Jane Smith" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
          <input type="text" value={draft.first_name ?? ''} onChange={(e) => onChange({ ...draft, first_name: e.target.value || null })} className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
          <input type="text" value={draft.last_name ?? ''} onChange={(e) => onChange({ ...draft, last_name: e.target.value || null })} className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
          <input type="text" value={draft.title ?? ''} onChange={(e) => onChange({ ...draft, title: e.target.value || null })} className={ic} placeholder="Project Manager" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input type="email" value={draft.email ?? ''} onChange={(e) => onChange({ ...draft, email: e.target.value || null })} className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email 2</label>
          <input type="email" value={draft.email2 ?? ''} onChange={(e) => onChange({ ...draft, email2: e.target.value || null })} className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input type="text" value={draft.phone ?? ''} onChange={(e) => onChange({ ...draft, phone: e.target.value || null })} placeholder="e.g. 9561234567 or +52 956 123 4567" className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone 2</label>
          <input type="text" value={draft.phone2 ?? ''} onChange={(e) => onChange({ ...draft, phone2: e.target.value || null })} placeholder="e.g. 9561234567 or +52 956 123 4567" className={ic} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ext</label>
          <input type="text" value={draft.phone_ext ?? ''} onChange={(e) => onChange({ ...draft, phone_ext: e.target.value || null })} className={ic} maxLength={10} />
        </div>
        <div className="col-span-3 flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" checked={draft.is_primary ?? false} onChange={(e) => onChange({ ...draft, is_primary: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
            Primary contact
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
            <input type="checkbox" checked={draft.is_ap_contact ?? false} onChange={(e) => onChange({ ...draft, is_ap_contact: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
            AP contact
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={pending} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={onSave} disabled={pending} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
          {pending ? 'Saving…' : isNew ? 'Add Contact' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function CustomerContactsSection({ customerId, orgId, orgSlug, initialContacts, inTab = false }: Props) {
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts)
  const [showAdd, setShowAdd] = useState(false)
  const [addDraft, setAddDraft] = useState<ContactInput & { full_name: string }>(emptyDraft())
  const [addError, setAddError] = useState<string | null>(null)
  const [addPending, startAddTransition] = useTransition()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<ContactInput & { full_name: string }>(emptyDraft())
  const [editError, setEditError] = useState<string | null>(null)
  const [editPending, startEditTransition] = useTransition()

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletePending, startDeleteTransition] = useTransition()

  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [primaryError, setPrimaryError] = useState<string | null>(null)
  const [primaryPending, startPrimaryTransition] = useTransition()

  function startEdit(c: ContactRow) {
    setEditingId(c.id)
    setEditDraft({
      full_name: c.full_name,
      first_name: c.first_name, last_name: c.last_name,
      email: c.email, email2: c.email2,
      phone: c.phone, phone2: c.phone2, phone_ext: c.phone_ext,
      title: c.title,
      is_primary: c.is_primary ?? false,
      is_ap_contact: c.is_ap_contact ?? false,
    })
    setEditError(null)
  }

  function handleAdd() {
    setAddError(null)
    if (!addDraft.full_name.trim()) { setAddError('Full name is required.'); return }
    startAddTransition(async () => {
      const res = await saveContact(customerId, orgId, orgSlug, addDraft)
      if (res.error) { setAddError(res.error); return }
      const newContact: ContactRow = {
        id: res.id!,
        full_name: addDraft.full_name.trim(),
        first_name: addDraft.first_name ?? null, last_name: addDraft.last_name ?? null,
        email: addDraft.email ?? null, email2: addDraft.email2 ?? null,
        phone: addDraft.phone ?? null, phone2: addDraft.phone2 ?? null,
        phone_ext: addDraft.phone_ext ?? null, title: addDraft.title ?? null,
        is_primary: addDraft.is_primary ?? false,
        is_ap_contact: addDraft.is_ap_contact ?? false,
        is_active: true,
      }
      setContacts((cs) => [...cs, newContact].sort((a, b) => {
        if ((b.is_primary ? 1 : 0) !== (a.is_primary ? 1 : 0)) return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
        return a.full_name.localeCompare(b.full_name)
      }))
      setShowAdd(false)
      setAddDraft(emptyDraft())
    })
  }

  function handleEdit() {
    if (!editingId) return
    setEditError(null)
    if (!editDraft.full_name.trim()) { setEditError('Full name is required.'); return }
    startEditTransition(async () => {
      const res = await saveContact(customerId, orgId, orgSlug, editDraft, editingId)
      if (res.error) { setEditError(res.error); return }
      setContacts((cs) => cs.map((c): ContactRow => c.id !== editingId ? c : {
        ...c,
        full_name: editDraft.full_name.trim(),
        first_name: editDraft.first_name ?? null, last_name: editDraft.last_name ?? null,
        email: editDraft.email ?? null, email2: editDraft.email2 ?? null,
        phone: editDraft.phone ?? null, phone2: editDraft.phone2 ?? null,
        phone_ext: editDraft.phone_ext ?? null, title: editDraft.title ?? null,
        is_primary: editDraft.is_primary ?? false,
        is_ap_contact: editDraft.is_ap_contact ?? false,
      }))
      setEditingId(null)
    })
  }

  function handleDelete(id: string) {
    setDeletingId(id)
    setDeleteError(null)
    startDeleteTransition(async () => {
      const res = await deleteContact(id, customerId, orgId, orgSlug)
      if (res.error) { setDeleteError(res.error); setDeletingId(null); return }
      setContacts((cs) => cs.filter((c) => c.id !== id))
      setDeletingId(null)
    })
  }

  function handleSetPrimary(id: string) {
    setSettingPrimaryId(id)
    setPrimaryError(null)
    startPrimaryTransition(async () => {
      const res = await setPrimaryContact(id, customerId, orgId, orgSlug)
      if (res.error) { setPrimaryError(res.error); setSettingPrimaryId(null); return }
      setContacts((cs) =>
        cs
          .map((c): ContactRow => ({ ...c, is_primary: c.id === id }))
          .sort((a, b) => {
            if ((b.is_primary ? 1 : 0) !== (a.is_primary ? 1 : 0))
              return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
            return a.full_name.localeCompare(b.full_name)
          })
      )
      setSettingPrimaryId(null)
    })
  }

  return (
    <div className={inTab ? '' : 'mt-6 rounded-xl border border-gray-200 bg-white shadow-sm'}>
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-base font-bold text-qm-black">
          Contacts {contacts.length > 0 && <span className="ml-1 text-xs font-normal text-qm-gray">({contacts.length})</span>}
        </h2>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setAddDraft(emptyDraft()); setAddError(null) }}
            className="inline-flex items-center gap-1.5 rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Contact
          </button>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {/* Add form */}
        {showAdd && (
          <div className="px-6 py-4">
            <ContactForm
              draft={addDraft} onChange={setAddDraft}
              error={addError} pending={addPending}
              onSave={handleAdd} onCancel={() => setShowAdd(false)} isNew
            />
          </div>
        )}

        {/* Empty state */}
        {contacts.length === 0 && !showAdd && (
          <p className="px-6 py-8 text-center text-sm text-qm-gray">No contacts yet. Add one above.</p>
        )}

        {/* Contact cards */}
        {contacts.map((c) => (
          <div key={c.id} className="px-6 py-4">
            {editingId === c.id ? (
              <ContactForm
                draft={editDraft} onChange={setEditDraft}
                error={editError} pending={editPending}
                onSave={handleEdit}
                onCancel={() => { setEditingId(null); setEditError(null) }}
                isNew={false}
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-qm-black">{c.full_name}</span>
                    {c.is_primary && (
                      <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2 py-0.5 text-xs font-semibold text-qm-lime-dark">Primary</span>
                    )}
                    {c.is_ap_contact && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">AP Contact</span>
                    )}
                  </div>
                  {c.title && <p className="text-xs text-qm-gray">{c.title}</p>}
                  {c.email && (
                    <p className="text-sm">
                      <a href={`mailto:${c.email}`} className="text-qm-lime hover:underline">{c.email}</a>
                      {c.email2 && <span className="text-qm-gray ml-2 text-xs">· {c.email2}</span>}
                    </p>
                  )}
                  {(c.phone || c.phone2) && (
                    <p className="text-sm text-gray-600">
                      {c.phone && <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>}
                      {c.phone_ext && <span className="text-qm-gray ml-1">ext {c.phone_ext}</span>}
                      {c.phone2 && <><span className="text-qm-gray mx-1">·</span><a href={`tel:${c.phone2}`} className="hover:underline text-xs">{c.phone2}</a></>}
                    </p>
                  )}
                  {deleteError && deletingId === c.id && (
                    <p className="text-xs text-red-600 mt-1">{deleteError}</p>
                  )}
                  {primaryError && settingPrimaryId === c.id && (
                    <p className="text-xs text-red-600 mt-1">{primaryError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!c.is_primary && (
                    <button
                      onClick={() => handleSetPrimary(c.id)}
                      disabled={primaryPending && settingPrimaryId === c.id}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-qm-lime-light hover:text-qm-lime-dark hover:border-qm-lime transition-colors disabled:opacity-40"
                      title="Set as primary contact"
                    >
                      {primaryPending && settingPrimaryId === c.id ? '…' : 'Set Primary'}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(c)}
                    className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 hover:text-qm-black transition-colors"
                    title="Edit"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deletePending && deletingId === c.id}
                    className="rounded-md border border-gray-200 p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-40"
                    title="Delete"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
