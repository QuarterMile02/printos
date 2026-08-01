import type { Modifier, ModifierType } from '@/types/product-builder'

const TYPE_BADGE: Record<ModifierType, string> = {
  Boolean: 'bg-qm-lime-light text-qm-lime',
  Numeric: 'bg-qm-fuchsia-light text-qm-fuchsia',
  Range:   'bg-blue-50 text-blue-700',
}

export function ModifierCard({ modifier, onClick }: { modifier: Modifier; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all text-left"
    >
      <span className={`self-start inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_BADGE[modifier.modifier_type]}`}>
        {modifier.modifier_type}
      </span>

      <div className="font-semibold text-sm text-qm-black truncate" title={modifier.display_name}>
        {modifier.display_name}
      </div>
      {modifier.system_lookup_name && (
        <div className="text-xs text-gray-500 truncate">{modifier.system_lookup_name}</div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            modifier.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {modifier.active ? 'Active' : 'Inactive'}
        </span>
        {modifier.units && <span className="text-xs text-gray-400 shrink-0">{modifier.units}</span>}
      </div>
    </button>
  )
}
