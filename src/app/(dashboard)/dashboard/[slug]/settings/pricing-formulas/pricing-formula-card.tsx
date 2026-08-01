import type { PricingFormula } from './pricing-formulas-client'

export function PricingFormulaCard({ formula, editable, onClick }: { formula: PricingFormula; editable: boolean; onClick: () => void }) {
  return (
    <div
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={editable ? onClick : undefined}
      onKeyDown={editable ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
      className={`flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-left transition-all ${
        editable ? 'cursor-pointer hover:border-qm-lime hover:shadow-md' : ''
      }`}
    >
      <span className="self-start inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        {formula.uom}
      </span>

      <div className="flex items-center gap-1.5">
        {formula.is_system && (
          <span title="System formula — read only" className="text-gray-400">●</span>
        )}
        {!formula.is_system && formula.is_locked && (
          <span title="Locked — read only" className="text-amber-500">●</span>
        )}
        <div className="font-semibold text-sm text-qm-black truncate" title={formula.name}>
          {formula.name}
        </div>
      </div>

      <code className="inline-block max-w-full truncate rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-800">
        {formula.formula}
      </code>

      {formula.description && (
        <p className="mt-auto text-xs text-gray-500 line-clamp-2 pt-1">{formula.description}</p>
      )}
    </div>
  )
}
