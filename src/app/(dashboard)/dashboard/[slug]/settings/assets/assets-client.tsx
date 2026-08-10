'use client'

import { useRef, useState } from 'react'
import { uploadAsset, deleteAsset, renameAssetCategory, createAssetCategory, getAssetUrl } from './actions'

export type AssetCategoryRow = { id: string; name: string; sort_order: number }
export type AssetRow = {
  id: string
  category_id: string | null
  name: string
  file_name: string
  mime_type: string
  file_size: number
  created_at: string
}

type Props = {
  orgId: string
  orgSlug: string
  initialCategories: AssetCategoryRow[]
  initialAssets: AssetRow[]
}

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

export default function AssetsClient({ orgId, orgSlug, initialCategories, initialAssets }: Props) {
  const [categories, setCategories] = useState(initialCategories)
  const [assets, setAssets] = useState(initialAssets)
  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryDraft, setNewCategoryDraft] = useState('')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const addCategorySubmittedRef = useRef(false)
  const [uploadCategoryId, setUploadCategoryId] = useState<string>(categories[0]?.id ?? '')
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const visibleAssets = activeCategoryId === 'all'
    ? assets
    : assets.filter((a) => a.category_id === activeCategoryId)

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    const result = await uploadAsset(orgId, orgSlug, uploadCategoryId || null, file)
    setUploading(false)
    if (result.error) {
      showToast(`Error: ${result.error}`)
      return
    }
    showToast('Uploaded')
    // Re-fetch not wired to a router.refresh() here -- append optimistically
    // using what we know; a full reload of category/name mapping happens
    // on next navigation. Simple and correct for a settings page.
    window.location.reload()
  }

  async function handleDelete(assetId: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return
    setDeletingId(assetId)
    const result = await deleteAsset(orgId, orgSlug, assetId)
    setDeletingId(null)
    if (result.error) {
      showToast(`Error: ${result.error}`)
      return
    }
    setAssets((prev) => prev.filter((a) => a.id !== assetId))
    showToast('Deleted')
  }

  async function handlePreview(assetId: string) {
    const result = await getAssetUrl(orgId, assetId)
    if (result.error || !result.url) {
      showToast(`Error: ${result.error ?? 'Failed to open file.'}`)
      return
    }
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  function startRename(cat: AssetCategoryRow) {
    setEditingCategoryId(cat.id)
    setCategoryDraft(cat.name)
  }

  async function saveRename(categoryId: string) {
    const trimmed = categoryDraft.trim()
    if (!trimmed) { setEditingCategoryId(null); return }
    const result = await renameAssetCategory(orgId, orgSlug, categoryId, trimmed)
    if (result.error) {
      showToast(`Error: ${result.error}`)
      setEditingCategoryId(null)
      return
    }
    setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c)))
    setEditingCategoryId(null)
    showToast('Category renamed')
  }

  function startAddCategory() {
    setNewCategoryDraft('')
    addCategorySubmittedRef.current = false
    setAddingCategory(true)
  }

  // Guarded with a ref (not state) so the Enter-key submit and the blur
  // that follows it can't both fire a create -- state wouldn't update in
  // time to block the second call within the same event tick, and unlike
  // renaming (idempotent), a duplicate call here means a duplicate category.
  async function handleAddCategory() {
    if (addCategorySubmittedRef.current) return
    addCategorySubmittedRef.current = true
    const trimmed = newCategoryDraft.trim()
    setAddingCategory(false)
    if (!trimmed) return
    setCreatingCategory(true)
    const result = await createAssetCategory(orgId, orgSlug, trimmed)
    setCreatingCategory(false)
    if (result.error || !result.category) {
      showToast(`Error: ${result.error ?? 'Failed to create category.'}`)
      return
    }
    setCategories((prev) => [...prev, result.category!])
    showToast('Category added')
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {/* Categories -- unlimited, freely add/rename (see createAssetCategory's
          header comment; migration 112's 3 seeded categories were a
          starting point, never an enforced cap). "Add New Category" +
          per-item "Edit" replace the old pencil-icon-per-chip pattern
          (ShopVOX's affordance, not PrintOS's -- see Materials' "New
          Material" / Material Categories' "New Category" buttons). */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Categories</h2>
          <button
            type="button"
            onClick={startAddCategory}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New Category
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveCategoryId('all')}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${activeCategoryId === 'all' ? 'bg-qm-lime text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All ({assets.length})
          </button>
          {categories.map((cat) => {
            const count = assets.filter((a) => a.category_id === cat.id).length
            return (
              <div key={cat.id} className="flex items-center gap-1.5">
                {editingCategoryId === cat.id ? (
                  <input
                    autoFocus
                    value={categoryDraft}
                    onChange={(e) => setCategoryDraft(e.target.value)}
                    onBlur={() => saveRename(cat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(cat.id)
                      if (e.key === 'Escape') setEditingCategoryId(null)
                    }}
                    className="rounded-full border border-qm-lime px-3 py-1.5 text-sm focus:outline-none"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveCategoryId(cat.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${activeCategoryId === cat.id ? 'bg-qm-lime text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {cat.name} ({count})
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(cat)}
                      className="text-xs font-medium text-gray-400 hover:text-qm-lime hover:underline underline-offset-2"
                      title="Edit category name"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            )
          })}
          {addingCategory && (
            <input
              autoFocus
              value={newCategoryDraft}
              onChange={(e) => setNewCategoryDraft(e.target.value)}
              onBlur={handleAddCategory}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCategory()
                if (e.key === 'Escape') { addCategorySubmittedRef.current = true; setAddingCategory(false) }
              }}
              placeholder="Category name"
              disabled={creatingCategory}
              className="rounded-full border border-qm-lime px-3 py-1.5 text-sm focus:outline-none disabled:opacity-50"
            />
          )}
        </div>
      </div>

      {/* Upload */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500">Upload</h2>
        <div className="flex items-center gap-3">
          <select
            value={uploadCategoryId}
            onChange={(e) => setUploadCategoryId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            onChange={(e) => handleUpload(e.target.files?.[0])}
            disabled={uploading}
            className="text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-qm-lime file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:brightness-110 disabled:opacity-50"
          />
          {uploading && <span className="text-sm text-gray-400">Uploading…</span>}
        </div>
        <p className="mt-2 text-xs text-gray-400">PDF, image, or document — up to 10MB.</p>
      </div>

      {/* Asset list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Files</h2>
        </div>
        {visibleAssets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No files in this category yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visibleAssets.map((asset) => {
              const category = categories.find((c) => c.id === asset.category_id)
              return (
                <li key={asset.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <button
                    type="button"
                    onClick={() => handlePreview(asset.id)}
                    className="flex min-w-0 items-center gap-3 text-left hover:opacity-80"
                  >
                    <span className="text-xl shrink-0">{fileIcon(asset.mime_type)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-800">{asset.file_name}</div>
                      <div className="text-xs text-gray-400">
                        {category?.name ?? 'Uncategorized'} · {formatBytes(asset.file_size)}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(asset.id, asset.file_name)}
                    disabled={deletingId === asset.id}
                    className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === asset.id ? 'Deleting…' : 'Delete'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
