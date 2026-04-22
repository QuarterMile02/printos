'use client'

import { useCallback, useRef, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────

type UploadedFile = {
  id: string
  name: string
  size: number
  dataUrl: string          // image as data:URL (already compressed for vehicle)
  mime: string
}

type WrapConcept = {
  concept_name: string
  tagline: string
  colors: string[]
  layout: string
  material: string
  complexity: string
  fal_prompt: string
}

type ConceptCardState = {
  concept: WrapConcept
  imageUrl: string | null
  loading: boolean
  error: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// Resize + re-encode an image to JPEG, max 768px on the longest edge.
async function compressImage(file: File, maxDim = 768, quality = 0.85): Promise<string> {
  const dataUrl = await fileToDataUrl(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = dataUrl
  })
  const { width, height } = img
  const ratio = Math.min(1, maxDim / Math.max(width, height))
  const w = Math.max(1, Math.round(width * ratio))
  const h = Math.max(1, Math.round(height * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

// Strip the `data:image/...;base64,` prefix.
function stripDataPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}

// ── Sub-components ───────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: 'Vehicle & Assets' },
    { n: 2, label: 'Business Info' },
    { n: 3, label: 'Generate' },
  ]
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              step >= s.n
                ? 'bg-qm-lime text-white'
                : 'bg-gray-200 text-gray-500'
            }`}
          >
            {s.n}
          </div>
          <span className={`text-sm font-semibold ${step === s.n ? 'text-qm-black' : 'text-gray-500'}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="h-px w-8 bg-gray-300" />}
        </div>
      ))}
    </div>
  )
}

type DropZoneProps = {
  label: string
  accept?: string
  multiple?: boolean
  compress?: boolean
  files: UploadedFile[]
  onAdd: (files: UploadedFile[]) => void
  onDelete: (id: string) => void
}

function DropZone({ label, accept = 'image/*', multiple = true, compress = false, files, onAdd, onDelete }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback(async (selected: FileList | File[]) => {
    const list = Array.from(selected)
    const out: UploadedFile[] = []
    for (const f of list) {
      if (!f.type.startsWith('image/')) continue
      const dataUrl = compress ? await compressImage(f) : await fileToDataUrl(f)
      out.push({ id: uid(), name: f.name, size: f.size, mime: f.type, dataUrl })
    }
    if (out.length > 0) onAdd(out)
  }, [compress, onAdd])

  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">{label}</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-qm-lime bg-qm-lime-light'
            : 'border-gray-300 bg-white hover:bg-gray-50'
        }`}
      >
        <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <p className="mt-2 text-sm font-semibold text-qm-black">Drop images here or click to browse</p>
        <p className="text-xs text-gray-500">{multiple ? 'Multiple images supported' : 'One image'}</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {files.map((f) => (
            <li key={f.id} className="group relative overflow-hidden rounded-md border border-gray-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.dataUrl} alt={f.name} className="aspect-square w-full object-cover" />
              <div className="flex items-center justify-between gap-1 border-t border-gray-100 px-2 py-1 text-[10px]">
                <span className="truncate" title={f.name}>{f.name}</span>
                <span className="shrink-0 text-gray-400">{formatBytes(f.size)}</span>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(f.id) }}
                className="absolute right-1 top-1 rounded-full bg-qm-fuchsia p-1 text-white opacity-0 shadow transition-opacity hover:brightness-110 group-hover:opacity-100"
                aria-label="Delete"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConceptCard({ card }: { card: ConceptCardState }) {
  const { concept, imageUrl, loading, error } = card
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="relative aspect-video bg-gray-100">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <svg className="h-8 w-8 animate-spin text-qm-lime" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-xs font-semibold text-gray-500">Generating image…</span>
            </div>
          </div>
        )}
        {!loading && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={concept.concept_name} className="h-full w-full object-cover" />
        )}
        {!loading && !imageUrl && error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-qm-fuchsia">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-base font-extrabold text-qm-black">{concept.concept_name}</h3>
          <p className="text-xs italic text-gray-500">{concept.tagline}</p>
        </div>

        {concept.colors.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Colors</p>
            <div className="flex gap-1.5">
              {concept.colors.map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  className="h-6 w-6 rounded-full border border-gray-200 shadow-sm"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Layout</p>
          <p className="text-xs leading-relaxed text-gray-700">{concept.layout}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Material</p>
            <p className="text-xs text-gray-700">{concept.material}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Complexity</p>
            <p className="text-xs text-gray-700">{concept.complexity}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────

export default function WrapConceptsPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1
  const [vehicle, setVehicle] = useState('')
  const [vehicleFiles, setVehicleFiles] = useState<UploadedFile[]>([])
  const [logoFiles, setLogoFiles] = useState<UploadedFile[]>([])
  const [extraFiles, setExtraFiles] = useState<UploadedFile[]>([])

  // Step 2
  const [bizName, setBizName] = useState('')
  const [bizType, setBizType] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [color1, setColor1] = useState('#93ca3b')
  const [color2, setColor2] = useState('#ee2b7b')
  const [color3, setColor3] = useState('#1a1a1a')
  const [styleNotes, setStyleNotes] = useState('')

  // Step 3
  const [cards, setCards] = useState<ConceptCardState[]>([])
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)

  const addVehicle = useCallback((f: UploadedFile[]) => setVehicleFiles((p) => [...p, ...f]), [])
  const delVehicle = useCallback((id: string) => setVehicleFiles((p) => p.filter((x) => x.id !== id)), [])
  const addLogo = useCallback((f: UploadedFile[]) => setLogoFiles((p) => [...p, ...f]), [])
  const delLogo = useCallback((id: string) => setLogoFiles((p) => p.filter((x) => x.id !== id)), [])
  const addExtra = useCallback((f: UploadedFile[]) => setExtraFiles((p) => [...p, ...f]), [])
  const delExtra = useCallback((id: string) => setExtraFiles((p) => p.filter((x) => x.id !== id)), [])

  const canAdvanceStep1 = vehicle.trim().length > 0 && vehicleFiles.length > 0
  const canAdvanceStep2 = bizName.trim().length > 0

  async function generateConcepts() {
    setBriefLoading(true)
    setBriefError(null)
    setCards([])
    try {
      const vehicleDataUrl = vehicleFiles[0].dataUrl
      const logoDataUrl = logoFiles[0]?.dataUrl

      const briefRes = await fetch('/api/claude-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleB64: vehicleDataUrl,
          logoB64: logoDataUrl,
          vehicle,
          bizName,
          bizType,
          colors: [color1, color2, color3].filter(Boolean),
          style: styleNotes,
          phone,
          website,
        }),
      })
      const briefData = (await briefRes.json()) as { concepts?: WrapConcept[]; error?: string }
      if (!briefRes.ok || briefData.error || !briefData.concepts) {
        throw new Error(briefData.error ?? 'Failed to generate concepts')
      }
      const initial: ConceptCardState[] = briefData.concepts.map((c) => ({
        concept: c,
        imageUrl: null,
        loading: true,
        error: null,
      }))
      setCards(initial)

      // Kick off each image generation in parallel; update per-card as they finish.
      await Promise.all(
        initial.map(async (_, i) => {
          try {
            const res = await fetch('/api/fal-proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                endpoint: 'fal-ai/flux/dev/image-to-image',
                body: {
                  prompt: initial[i].concept.fal_prompt,
                  image_url: `data:image/jpeg;base64,${stripDataPrefix(vehicleDataUrl)}`,
                  strength: 0.75,
                  num_images: 1,
                },
              }),
            })
            const data = await res.json() as { images?: Array<{ url: string }>; error?: string }
            const url = data.images?.[0]?.url ?? null
            setCards((prev) => prev.map((p, j) => j === i ? { ...p, loading: false, imageUrl: url, error: url ? null : (data.error ?? 'No image returned') } : p))
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setCards((prev) => prev.map((p, j) => j === i ? { ...p, loading: false, error: msg } : p))
          }
        }),
      )
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : String(e))
    } finally {
      setBriefLoading(false)
    }
  }

  async function handleNext() {
    if (step === 1) setStep(2)
    else if (step === 2) {
      setStep(3)
      await generateConcepts()
    }
  }

  function handleBack() {
    if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
  }

  const inputCls = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-qm-black">AI Vehicle Wrap Concepts</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a vehicle photo and brand assets, describe the business, and generate three
          design concepts with Claude + fal.ai.
        </p>
      </div>

      <div className="mb-8">
        <StepIndicator step={step} />
      </div>

      {/* ── Step 1 ───────────────────────────────────────────── */}
      {step === 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">
              Vehicle year / make / model
            </label>
            <input
              className={`mt-1 ${inputCls}`}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="2022 Ford F-150 Lariat"
            />
          </div>

          <DropZone
            label="Vehicle photo (required, compressed to 768px)"
            multiple={false}
            compress
            files={vehicleFiles}
            onAdd={addVehicle}
            onDelete={delVehicle}
          />

          <DropZone
            label="Logo"
            multiple={false}
            files={logoFiles}
            onAdd={addLogo}
            onDelete={delLogo}
          />

          <DropZone
            label="Extra assets (optional)"
            multiple
            files={extraFiles}
            onAdd={addExtra}
            onDelete={delExtra}
          />
        </div>
      )}

      {/* ── Step 2 ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Business Name</label>
              <input className={`mt-1 ${inputCls}`} value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Acme Plumbing" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Business Type / Industry</label>
              <input className={`mt-1 ${inputCls}`} value={bizType} onChange={(e) => setBizType(e.target.value)} placeholder="Plumbing, Landscaping, etc." />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Phone</label>
              <input className={`mt-1 ${inputCls}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Website</label>
              <input className={`mt-1 ${inputCls}`} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acmeplumbing.com" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Brand colors</label>
            <div className="flex flex-wrap gap-4">
              {[
                { v: color1, set: setColor1, label: 'Primary' },
                { v: color2, set: setColor2, label: 'Secondary' },
                { v: color3, set: setColor3, label: 'Accent' },
              ].map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={c.v}
                    onChange={(e) => c.set(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-gray-300"
                  />
                  <div>
                    <div className="text-xs font-semibold text-qm-black">{c.label}</div>
                    <div className="text-[10px] font-mono text-gray-500">{c.v}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Style notes</label>
            <textarea
              className={`mt-1 ${inputCls}`}
              rows={4}
              value={styleNotes}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="Bold / minimal / retro / modern — describe the vibe, inspiration, and must-haves."
            />
          </div>
        </div>
      )}

      {/* ── Step 3 ───────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          {briefLoading && cards.length === 0 && (
            <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-12">
              <div className="flex flex-col items-center gap-3">
                <svg className="h-10 w-10 animate-spin text-qm-lime" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm font-semibold text-gray-600">Asking Claude to design 3 concepts…</span>
              </div>
            </div>
          )}

          {briefError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {briefError}
            </div>
          )}

          {cards.length > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {cards.map((c, i) => <ConceptCard key={i} card={c} />)}
            </div>
          )}

          {cards.length > 0 && !briefLoading && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => generateConcepts()}
                className="rounded-md border border-qm-fuchsia bg-white px-4 py-2 text-sm font-semibold text-qm-fuchsia hover:bg-qm-fuchsia hover:text-white transition-colors"
              >
                Regenerate concepts
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Navigation ─────────────────────────────────────── */}
      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={(step === 1 && !canAdvanceStep1) || (step === 2 && !canAdvanceStep2)}
            className="rounded-md bg-qm-lime px-6 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === 2 ? 'Generate concepts' : 'Next'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setStep(1); setCards([]); setBriefError(null) }}
            className="rounded-md bg-qm-lime px-6 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  )
}
