'use client'

import { useState, useTransition, useCallback } from 'react'
import { updateJobFlag, updateJobDescription } from '../actions'
import type { JobFlag } from '@/types/database'
import VoiceInput from '@/components/voice-input'

type Props = {
  jobId: string
  orgId: string
  orgSlug: string
  description: string | null
  flag: JobFlag | null
}

export default function JobDetailClient({ jobId, orgId, orgSlug, description, flag }: Props) {
  const [notes, setNotes] = useState(description ?? '')
  const [currentFlag, setCurrentFlag] = useState<JobFlag | null>(flag)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const handleVoiceTranscript = useCallback((text: string) => {
    setNotes((prev) => (prev ? prev + ' ' : '') + text)
  }, [])

  function saveNotes() {
    setSaved(false)
    startTransition(async () => {
      const result = await updateJobDescription(jobId, orgId, orgSlug, notes)
      if (!result.error) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  function handleFlag(newFlag: JobFlag | null) {
    setCurrentFlag(newFlag)
    startTransition(async () => {
      const result = await updateJobFlag(jobId, orgId, orgSlug, newFlag)
      if (result.error) {
        setCurrentFlag(flag) // revert
      }
    })
  }

  return (
    <>
      {/* Notes / Description */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Notes / Description</h2>
          <VoiceInput onTranscript={handleVoiceTranscript} />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Job details, specifications, special instructions..."
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={saveNotes}
            disabled={isPending}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {isPending ? 'Saving...' : 'Save Notes'}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Saved</span>
          )}
        </div>
      </div>

      {/* Flag Controls */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-qm-black mb-4">Flags</h2>
        <div className="flex flex-wrap gap-3">
          {currentFlag === 'file_error' ? (
            <button
              onClick={() => handleFlag(null)}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Clear File Error
            </button>
          ) : (
            <button
              onClick={() => handleFlag('file_error')}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              Flag File Error
            </button>
          )}

          {currentFlag === 'help_needed' ? (
            <button
              onClick={() => handleFlag(null)}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              Clear Help Needed
            </button>
          ) : (
            <button
              onClick={() => handleFlag('help_needed')}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
              </svg>
              Flag Help Needed
            </button>
          )}
        </div>
        {currentFlag && (
          <p className="mt-3 text-xs text-qm-gray">
            Currently flagged as <span className="font-semibold">{currentFlag === 'file_error' ? 'File Error' : 'Help Needed'}</span>. Click the active flag button to clear it.
          </p>
        )}
      </div>
    </>
  )
}
