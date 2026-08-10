'use client'

// Canonical settings-page status/filter tabs -- underline style. This is
// the convention Material Types, Material Categories, Product Categories,
// Product Types, Materials, Promo Codes, Discounts, and Quotes all already
// use (byte-identical inline JSX, copy-pasted across each). Extracted here
// so future settings pages import this instead of re-copying it, and so a
// style correction (like the pill-tab detour Email Templates/Assets took)
// only has to happen in one place.
//
// Explicitly NOT the filled-pill style (rounded-full, bg-qm-lime-light) --
// that was tried as the candidate canonical style and reverted; Quotes'
// underline tabs are the confirmed reference.

export type SettingsTab<T extends string = string> = {
  key: T
  label: string
  count: number
}

type Props<T extends string> = {
  tabs: SettingsTab<T>[]
  active: T
  onChange: (key: T) => void
}

export function SettingsTabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            active === t.key
              ? 'border-qm-lime text-qm-lime'
              : 'border-transparent text-qm-gray hover:text-qm-black'
          }`}
        >
          {t.label}
          <span className="ml-1.5 text-xs text-qm-gray">({t.count})</span>
        </button>
      ))}
    </div>
  )
}
