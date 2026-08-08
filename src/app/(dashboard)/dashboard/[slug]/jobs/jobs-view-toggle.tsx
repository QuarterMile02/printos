'use client'

import { useState } from 'react'
import type { ComponentProps } from 'react'
import KanbanBoard from './kanban-board'
import JobsListClient from './jobs-list-client'

type ViewMode = 'card' | 'list'

type Props = {
  kanbanProps: ComponentProps<typeof KanbanBoard>
  listProps: ComponentProps<typeof JobsListClient>
}

// The kanban board owns its own, separate department-based filtering (not
// the shared data-table filter/saved-view system — it never needed one),
// so this stays a simple local toggle between two otherwise-independent
// subtrees rather than trying to force Kanban through the data-table
// paradigm. The toggle control's look intentionally matches
// DataTableToolbar's own List/Card buttons (used on Materials/Discounts/
// Email Templates) for visual consistency, even though the state itself
// isn't wired through useSavedView the way JobsListClient's internal
// viewMode-agnostic filters/sort are.
export default function JobsViewToggle({ kanbanProps, listProps }: Props) {
  const [mode, setMode] = useState<ViewMode>('card')

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <div className="inline-flex rounded-md border border-gray-300 p-0.5">
          <button
            type="button"
            onClick={() => setMode('list')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'list' ? 'bg-qm-lime-light text-qm-lime-dark' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
            List
          </button>
          <button
            type="button"
            onClick={() => setMode('card')}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              mode === 'card' ? 'bg-qm-lime-light text-qm-lime-dark' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
            Card
          </button>
        </div>
      </div>

      {mode === 'card' ? <KanbanBoard {...kanbanProps} /> : <JobsListClient {...listProps} />}
    </div>
  )
}
