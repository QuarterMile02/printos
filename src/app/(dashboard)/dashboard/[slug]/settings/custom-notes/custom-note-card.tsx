import Link from 'next/link'
import type { NoteRow } from './custom-notes-list-client'

const TYPE_BADGE: Record<string, string> = {
  void_reason: 'bg-red-50 text-red-700',
  lost_reason: 'bg-orange-50 text-orange-700',
  customer_note: 'bg-blue-50 text-blue-700',
  job_note: 'bg-amber-50 text-amber-700',
  quote_note: 'bg-purple-50 text-purple-700',
  sales_order_note: 'bg-teal-50 text-teal-700',
  invoice_note: 'bg-indigo-50 text-indigo-700',
}
const TYPE_LABEL: Record<string, string> = {
  customer_note: 'Customer Note',
  quote_note: 'Quote Note',
  sales_order_note: 'Sales Order Note',
  invoice_note: 'Invoice Note',
  job_note: 'Job Note',
  void_reason: 'Void Reason',
  lost_reason: 'Lost Reason',
}

export function CustomNoteCard({ note, orgSlug }: { note: NoteRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/settings/custom-notes?edit=${note.id}`

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <span className={`self-start inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[note.type] ?? 'bg-gray-100 text-gray-600'}`}>
        {TYPE_LABEL[note.type] ?? note.type}
      </span>

      <div className="font-semibold text-sm text-qm-black truncate" title={note.title}>
        {note.title}
      </div>
      <p className="text-xs text-gray-500 line-clamp-2">{note.body}</p>

      <div className="mt-auto pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            note.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {note.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </Link>
  )
}
