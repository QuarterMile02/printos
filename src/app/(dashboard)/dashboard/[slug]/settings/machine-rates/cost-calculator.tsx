'use client'

import { useState } from 'react'

type Props = {
  initial: {
    calc_equipment_cost: number | null
    calc_life_expectancy_years: number | null
    calc_days_per_year: number | null
    calc_hours_per_day: number | null
    calc_productivity_percent: number | null
  }
}

const inputClass = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function fmtMoney(v: number | null): string {
  if (v == null || !isFinite(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CostCalculator({ initial }: Props) {
  const [open, setOpen] = useState(false)
  const [equipmentCost, setEquipmentCost] = useState<string>(initial.calc_equipment_cost?.toString() ?? '')
  const [lifeYears, setLifeYears] = useState<string>(initial.calc_life_expectancy_years?.toString() ?? '')
  const [daysPerYear, setDaysPerYear] = useState<string>(initial.calc_days_per_year?.toString() ?? '')
  const [hoursPerDay, setHoursPerDay] = useState<string>(initial.calc_hours_per_day?.toString() ?? '')
  const [productivity, setProductivity] = useState<string>(initial.calc_productivity_percent?.toString() ?? '')

  const ec = parseFloat(equipmentCost)
  const ly = parseFloat(lifeYears)
  const dy = parseFloat(daysPerYear)
  const hd = parseFloat(hoursPerDay)
  const pp = parseFloat(productivity)
  const denom = ly * dy * hd * (pp / 100)
  const calculated = isFinite(ec) && isFinite(denom) && denom > 0 ? ec / denom : null

  function applyToCost() {
    if (calculated == null) return
    const costInput = document.querySelector<HTMLInputElement>('input[name="cost"]')
    if (costInput) {
      costInput.value = calculated.toFixed(2)
      costInput.dispatchEvent(new Event('input', { bubbles: true }))
      costInput.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span>Cost Calculator</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-200 p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500">Equipment Cost ($)</label>
              <input
                type="number" step="0.01" name="calc_equipment_cost"
                value={equipmentCost} onChange={e => setEquipmentCost(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500">Life Expectancy (years)</label>
              <input
                type="number" step="0.1" name="calc_life_expectancy_years"
                value={lifeYears} onChange={e => setLifeYears(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500">Days / Year</label>
              <input
                type="number" step="0.1" name="calc_days_per_year"
                value={daysPerYear} onChange={e => setDaysPerYear(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500">Hours / Day</label>
              <input
                type="number" step="0.1" name="calc_hours_per_day"
                value={hoursPerDay} onChange={e => setHoursPerDay(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500">Productivity (%)</label>
              <input
                type="number" step="0.1" name="calc_productivity_percent"
                value={productivity} onChange={e => setProductivity(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="rounded-md border border-qm-lime/30 bg-qm-lime/5 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Calculated Cost / Hr</div>
              <div className="text-lg font-extrabold text-gray-900 tabular-nums">{fmtMoney(calculated)}</div>
            </div>
            <button
              type="button"
              onClick={applyToCost}
              disabled={calculated == null}
              className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply to Cost Field
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
