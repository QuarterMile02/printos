'use client'

import { useEffect, useState } from 'react'
import { listAssetsForPicker, type PickerAsset, type PickerAssetCategory } from './actions'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType === 'application/pdf') return '📄'
  return '📎'
}

export type LibraryAttachment = { assetId: string; fileName: string }

type Props = {
  open: boolean
  onClose: () => void
  onAttach: (selected: LibraryAttachment[]) => void
  orgId: string
  alreadyAttachedIds: string[]
}

export default function AttachFromLibraryModal({ open, onClose, onAttach, orgId, alreadyAttachedIds }: Props) {
  const [categories, setCategories] = useState<PickerAssetCategory[]>([])
  const [assets, setAssets] = useState<PickerAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setSelectedIds(new Set())
    setLoading(true)
    setError(null)
    listAssetsForPicker(orgId).then((result) => {
      if (result.error) setError(result.error)
      setCategories(result.categories)
      setAssets(result.assets)
      setLoading(false)
    })
  }, [open, orgId])

  if (!open) return null

  function toggle(assetId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  function handleAttach() {
    const selected = assets
      .filter((a) => selectedIds.has(a.id))
      .map((a) => ({ assetId: a.id, fileName: a.file_name }))
    onAttach(selected)
    onClose()
  }

  const availableAssets = assets.filter((a) => !alreadyAttachedIds.includes(a.id))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Attach from Library</h2>
        <p className="mt-1 text-sm text-gray-500">Select one or more files to attach.</p>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>
        )}

        {loading ? (
          <div className="mt-6 text-center text-sm text-gray-400">Loading…</div>
        ) : availableAssets.length === 0 ? (
          <div className="mt-6 text-center text-sm text-gray-400">
            {assets.length === 0 ? 'No files in the library yet.' : 'All library files are already attached.'}
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 rounded-md border border-gray-200">
            {availableAssets.map((asset) => {
              const category = categories.find((c) => c.id === asset.category_id)
              const checked = selectedIds.has(asset.id)
              return (
                <li key={asset.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(asset.id)}
                      className="h-4 w-4 rounded border-gray-300 accent-qm-lime"
                    />
                    <span className="text-lg shrink-0">{fileIcon(asset.mime_type)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">{asset.file_name}</div>
                      <div className="text-xs text-gray-400">
                        {category?.name ?? 'Uncategorized'} · {formatBytes(asset.file_size)}
                      </div>
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAttach}
            disabled={selectedIds.size === 0}
            className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            Attach {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
