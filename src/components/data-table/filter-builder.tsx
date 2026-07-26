'use client'

import type { ColumnMeta, FilterRule, FilterOperator } from './types'

const OPERATORS: { value: FilterOperator; label: string; hasValue: boolean }[] = [
  { value: 'contains',      label: 'contains',         hasValue: true  },
  { value: 'not_contains',  label: 'does not contain',  hasValue: true  },
  { value: 'equals',        label: 'equals',            hasValue: true  },
  { value: 'not_equals',    label: 'not equals',        hasValue: true  },
  { value: 'starts_with',   label: 'starts with',       hasValue: true  },
  { value: 'is_empty',      label: 'is empty',          hasValue: false },
  { value: 'is_not_empty',  label: 'is not empty',      hasValue: false },
]

let _id = 0
function nextId() { return `fr${++_id}` }

interface Props {
  columns: ColumnMeta[]
  rules: FilterRule[]
  onChange: (rules: FilterRule[]) => void
  disabled?: boolean
}

export function FilterBuilder({ columns, rules, onChange, disabled }: Props) {
  const filterable = columns.filter((c) => c.filterable !== false)

  const addRule = () => {
    const col = filterable[0]
    if (!col) return
    onChange([...rules, { id: nextId(), column: col.key, operator: 'contains', value: '' }])
  }

  const update = (id: string, patch: Partial<FilterRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const remove = (id: string) =>
    onChange(rules.filter((r) => r.id !== id))

  return (
    <div className="space-y-2.5">
      {rules.length === 0 && (
        <p className="text-xs text-gray-400 py-1">No filters — all rows shown.</p>
      )}

      {rules.map((rule) => {
        const op = OPERATORS.find((o) => o.value === rule.operator) ?? OPERATORS[0]
        const col = filterable.find((c) => c.key === rule.column) ?? filterable[0]
        return (
          <div key={rule.id} className="flex items-center gap-2 flex-wrap">
            {/* WHERE label */}
            <span className="text-xs font-medium text-gray-400 w-10 shrink-0 text-right">
              {rules.indexOf(rule) === 0 ? 'Where' : 'And'}
            </span>

            {/* Column */}
            <select
              value={rule.column}
              onChange={(e) => update(rule.id, { column: e.target.value })}
              disabled={disabled}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
            >
              {filterable.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>

            {/* Operator */}
            <select
              value={rule.operator}
              onChange={(e) => update(rule.id, { operator: e.target.value as FilterOperator })}
              disabled={disabled}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* Value */}
            {op.hasValue && (
              col?.filterType === 'select' && col.filterOptions ? (
                <select
                  value={rule.value}
                  onChange={(e) => update(rule.id, { value: e.target.value })}
                  disabled={disabled}
                  className="rounded border border-gray-300 px-2 py-1.5 text-xs w-36 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">— any —</option>
                  {col.filterOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={col?.filterType === 'number' ? 'number' : 'text'}
                  value={rule.value}
                  onChange={(e) => update(rule.id, { value: e.target.value })}
                  disabled={disabled}
                  placeholder="Value"
                  className="rounded border border-gray-300 px-2 py-1.5 text-xs w-36 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:bg-gray-50 disabled:text-gray-400"
                />
              )
            )}

            {/* Delete rule */}
            <button
              type="button"
              onClick={() => remove(rule.id)}
              disabled={disabled}
              className="rounded p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
              title="Remove filter"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}

      <button
        type="button"
        onClick={addRule}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs font-medium text-qm-lime hover:text-qm-lime-dark disabled:opacity-40 transition-colors mt-1"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add filter
      </button>
    </div>
  )
}
