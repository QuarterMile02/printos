'use client'

import { useState, useTransition } from 'react'
import { updateJobDepartment } from '../actions'

export const DEPT_OPTIONS = [
  { code: 'large_format',      name: 'Large Format' },
  { code: 'commercial_print',  name: 'Commercial Print' },
  { code: 'vehicle_wrap',      name: 'Vehicle Wrap' },
  { code: 'channel_letters',   name: 'Channel Letters' },
  { code: 'fabrication',       name: 'Fabrication' },
  { code: 'installation',      name: 'Installation' },
  { code: 'service_repair',    name: 'Service & Repair' },
  { code: 'digital_marketing', name: 'Digital Marketing' },
  { code: 'digital_screens',   name: 'Digital Screens' },
] as const

type Props = {
  jobId: string
  orgId: string
  orgSlug: string
  currentDepartment: string | null
  canAssign: boolean
}

export default function DepartmentSelect({ jobId, orgId, orgSlug, currentDepartment, canAssign }: Props) {
  const [dept, setDept] = useState(currentDepartment)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const label = DEPT_OPTIONS.find((d) => d.code === dept)?.name ?? null

  function handleChange(value: string) {
    const next = value === '' ? null : value
    setDept(next)
    setError(null)
    startTransition(async () => {
      const result = await updateJobDepartment(jobId, orgId, orgSlug, next)
      if (result.error) {
        setDept(currentDepartment)
        setError(result.error)
      }
    })
  }

  if (!canAssign) {
    return label ? (
      <span className="inline-block rounded-full bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700">
        {label}
      </span>
    ) : null
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={dept ?? ''}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:opacity-50"
      >
        <option value="">— No Department —</option>
        {DEPT_OPTIONS.map((d) => (
          <option key={d.code} value={d.code}>{d.name}</option>
        ))}
      </select>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  )
}
