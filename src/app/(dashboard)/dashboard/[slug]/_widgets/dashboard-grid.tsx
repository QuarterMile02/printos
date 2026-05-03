'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { saveLayout, resetLayout } from '../layout-actions'
import { WIDGET_META } from '@/lib/dashboard/widget-registry'

// ── Types ─────────────────────────────────────────────────────────────────────

type WidgetItem = {
  id: string
  span: 6 | 12
  pinned: boolean
  label: string
}

export type Props = {
  // Pre-rendered server component output, keyed by widget id.
  widgetMap: Record<string, ReactNode>
  // Ordered list of visible widget IDs.
  orderedIds: string[]
  // Widgets the user's role can see but aren't currently in the layout.
  availableToAdd: string[]
  canCustomize: boolean
  orgId: string
  orgSlug: string
}

// ── SortableItem ─────────────────────────────────────────────────────────────

function SortableItem({
  item, editMode, children,
  onRemove,
}: {
  item: WidgetItem
  editMode: boolean
  children: ReactNode
  onRemove: (id: string) => void
}) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: item.id })

  const colSpan = item.span === 6 ? 'lg:col-span-6' : 'lg:col-span-12'

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`col-span-12 ${colSpan} ${isDragging ? 'opacity-40 z-50' : ''}`}
    >
      <div className="relative">
        {/* Edit mode overlay bar — drag handle + label + remove button */}
        {editMode && (
          <div
            className="absolute inset-x-0 top-0 z-20 flex items-center justify-between rounded-t-xl bg-gray-900/85 px-3 py-1.5"
            style={{ cursor: 'grab' }}
            {...attributes}
            {...listeners}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-white select-none">
              <svg className="h-3.5 w-3.5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
              </svg>
              {item.label}
              {item.pinned && <span className="ml-1 text-xs text-gray-500">(pinned)</span>}
            </span>
            {!item.pinned && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
                className="ml-2 rounded p-0.5 text-gray-400 hover:bg-white/20 hover:text-white transition-colors"
                title="Remove widget"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Widget content */}
        <div className={editMode ? 'pointer-events-none select-none' : ''}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── DragOverlay ghost card ────────────────────────────────────────────────────

function GhostCard({ label }: { label: string }) {
  return (
    <div className="col-span-12 rounded-xl border-2 border-dashed border-qm-lime bg-white/80 shadow-lg px-4 py-6 text-center">
      <p className="text-sm font-semibold text-qm-lime">{label}</p>
    </div>
  )
}

// ── Add Widget Modal ──────────────────────────────────────────────────────────

function AddWidgetModal({
  availableToAdd,
  onAdd,
  onClose,
}: {
  availableToAdd: string[]
  onAdd: (id: string) => void
  onClose: () => void
}) {
  if (availableToAdd.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative z-10 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-base font-bold text-gray-900 mb-2">Add Widget</h2>
          <p className="text-sm text-gray-500">All available widgets are already on your dashboard.</p>
          <button onClick={onClose} className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">Add Widget</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:text-gray-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-3">Added widgets appear at the bottom of your dashboard.</p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {availableToAdd.map((id) => {
            const meta = WIDGET_META[id]
            return (
              <button
                key={id}
                type="button"
                onClick={() => onAdd(id)}
                className="w-full flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-qm-lime hover:bg-qm-lime-light transition-colors"
              >
                <span className="text-sm font-medium text-gray-900">{meta?.label ?? id}</span>
                <svg className="h-4 w-4 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main DashboardGrid ────────────────────────────────────────────────────────

export default function DashboardGrid({
  widgetMap,
  orderedIds,
  availableToAdd,
  canCustomize,
  orgId,
  orgSlug,
}: Props) {
  const router = useRouter()

  const [editMode, setEditMode]         = useState(false)
  const [localOrder, setLocalOrder]     = useState(orderedIds)
  const [localAvailable, setLocalAvailable] = useState(availableToAdd)
  const [activeId, setActiveId]         = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [savedToast, setSavedToast]     = useState(false)
  const [toastMsg, setToastMsg]         = useState('Layout saved')

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ── Save helpers ─────────────────────────────────────────────────────────

  const showToast = useCallback((msg = 'Layout saved') => {
    setToastMsg(msg)
    setSavedToast(true)
    setTimeout(() => setSavedToast(false), 2500)
  }, [])

  const scheduleSave = useCallback((ids: string[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const res = await saveLayout(orgId, orgSlug, ids)
      if (!res.error) showToast()
    }, 1000)
  }, [orgId, orgSlug, showToast])

  const immediateSave = useCallback(async (ids: string[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const res = await saveLayout(orgId, orgSlug, ids)
    if (!res.error) showToast()
    router.refresh()
  }, [orgId, orgSlug, showToast, router])

  // ── Drag handlers ─────────────────────────────────────────────────────────

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over || active.id === over.id) return
    setLocalOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as string)
      const newIdx = prev.indexOf(over.id as string)
      const next   = arrayMove(prev, oldIdx, newIdx)
      scheduleSave(next)
      return next
    })
  }

  function handleDragCancel() { setActiveId(null) }

  // ── Edit mode ─────────────────────────────────────────────────────────────

  function enterEditMode() { setEditMode(true) }

  function exitEditMode() {
    setEditMode(false)
    // Flush any pending debounced save, then refresh once to sync server.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveLayout(orgId, orgSlug, localOrder).then(() => router.refresh())
    } else {
      router.refresh()
    }
  }

  // ── Remove / add ──────────────────────────────────────────────────────────

  function handleRemove(id: string) {
    const next = localOrder.filter((w) => w !== id)
    setLocalOrder(next)
    setLocalAvailable((prev) => [...prev, id].sort())
    immediateSave(next)
  }

  function handleAdd(id: string) {
    const next = [...localOrder, id]
    setLocalOrder(next)
    setLocalAvailable((prev) => prev.filter((w) => w !== id))
    setShowAddModal(false)
    immediateSave(next)
  }

  // ── Reset to default ──────────────────────────────────────────────────────

  async function handleReset() {
    const res = await resetLayout(orgId, orgSlug)
    if (!res.error) {
      setEditMode(false)
      showToast('Reset to default')
      router.refresh()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeItem = activeId ? (WIDGET_META[activeId] ?? null) : null

  // Build WidgetItem descriptors for current order
  const items: WidgetItem[] = localOrder.map((id) => ({
    id,
    span:   (WIDGET_META[id]?.defaultSpan ?? 12) as 6 | 12,
    pinned: WIDGET_META[id]?.pinned ?? false,
    label:  WIDGET_META[id]?.label ?? id,
  }))

  return (
    <div className="relative">
      {/* ── Edit mode toolbar ── */}
      {canCustomize && (
        <div className="mb-4 flex flex-wrap items-center gap-2 justify-end">
          {editMode ? (
            <>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Widget
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                Reset to Default
              </button>
              <button
                type="button"
                onClick={exitEditMode}
                className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110"
              >
                Done
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={enterEditMode}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
              Edit Layout
            </button>
          )}
        </div>
      )}

      {/* ── Edit mode hint banner ── */}
      {editMode && (
        <div className="mb-4 rounded-lg border border-dashed border-qm-lime bg-qm-lime-light px-4 py-2.5 text-sm text-qm-lime-dark">
          Drag widgets to reorder · Click <strong>✕</strong> to remove · Click <strong>Done</strong> to save
        </div>
      )}

      {/* ── Widget grid ── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={localOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-4">
            {items.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                editMode={editMode}
                onRemove={handleRemove}
              >
                {widgetMap[item.id] ?? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
                    {item.label}
                  </div>
                )}
              </SortableItem>
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeItem ? <GhostCard label={activeItem.label} /> : null}
        </DragOverlay>
      </DndContext>

      {/* ── Add Widget modal ── */}
      {showAddModal && (
        <AddWidgetModal
          availableToAdd={localAvailable}
          onAdd={handleAdd}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* ── Saved toast ── */}
      {savedToast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
            <svg className="h-4 w-4 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            {toastMsg}
          </div>
        </div>
      )}
    </div>
  )
}
