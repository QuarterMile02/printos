'use client';

import { useState, useEffect, useCallback } from 'react';

const UOB_KEYS = [
  'large_format',
  'commercial_print',
  'vehicle_wrap',
  'channel_letters',
  'fabrication',
  'installation',
  'service_repair',
  'digital_marketing',
  'digital_screens',
] as const;

const UOB_LABELS: Record<string, string> = {
  large_format: 'Large Format',
  commercial_print: 'Commercial Print',
  vehicle_wrap: 'Vehicle Wrap',
  channel_letters: 'Channel Letters',
  fabrication: 'Fabrication',
  installation: 'Installation',
  service_repair: 'Service / Repair',
  digital_marketing: 'Digital Marketing',
  digital_screens: 'Digital Screens',
};

interface PortalTier {
  id: string;
  name: string;
  is_active: boolean;
  customer_count: number;
}

interface DiscountRow {
  unit_of_business: string;
  product_type: string;
  discount_percent: number;
}

interface Props {
  slug: string;
  productTypes: string[];
}

function gridKey(uob: string, productType: string) {
  return `${uob}__${productType}`;
}

export default function PortalTiersClient({ productTypes }: Props) {
  const [tiers, setTiers] = useState<PortalTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<PortalTier | null>(null);

  // Discount grid state
  const [discountDraft, setDiscountDraft] = useState<Record<string, string>>({});
  const [loadingDiscounts, setLoadingDiscounts] = useState(false);
  const [savingDiscounts, setSavingDiscounts] = useState(false);
  const [discountSaved, setDiscountSaved] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Add tier state
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Per-tier toggle saving state
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const fetchTiers = useCallback(async () => {
    const res = await fetch('/api/portal-tiers');
    const data = await res.json();
    setTiers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTiers(); }, [fetchTiers]);

  const loadDiscounts = useCallback(async (tierId: string) => {
    setLoadingDiscounts(true);
    setDiscountError(null);
    const res = await fetch(`/api/portal-tiers/${tierId}/discounts`);
    const data: DiscountRow[] = await res.json();
    const draft: Record<string, string> = {};
    for (const row of data) {
      draft[gridKey(row.unit_of_business, row.product_type)] = String(row.discount_percent);
    }
    setDiscountDraft(draft);
    setLoadingDiscounts(false);
  }, []);

  function openTier(tier: PortalTier) {
    setSelectedTier(tier);
    setDiscountSaved(false);
    loadDiscounts(tier.id);
  }

  async function toggleActive(tier: PortalTier) {
    setToggling((prev) => ({ ...prev, [tier.id]: true }));
    const res = await fetch(`/api/portal-tiers/${tier.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !tier.is_active }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, is_active: updated.is_active } : t)));
      if (selectedTier?.id === tier.id) setSelectedTier((prev) => prev ? { ...prev, is_active: updated.is_active } : prev);
    }
    setToggling((prev) => ({ ...prev, [tier.id]: false }));
  }

  async function addTier() {
    const name = newName.trim();
    if (!name) { setAddError('Name is required'); return; }
    setAddSaving(true);
    setAddError(null);
    const res = await fetch('/api/portal-tiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error ?? 'Failed to add tier'); setAddSaving(false); return; }
    setTiers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName('');
    setAddingNew(false);
    setAddSaving(false);
  }

  async function saveDiscounts() {
    if (!selectedTier) return;
    setSavingDiscounts(true);
    setDiscountError(null);

    const rows: DiscountRow[] = [];
    for (const uob of UOB_KEYS) {
      for (const pt of productTypes) {
        const raw = discountDraft[gridKey(uob, pt)];
        const pct = raw ? parseFloat(raw) : 0;
        if (!isNaN(pct)) {
          rows.push({ unit_of_business: uob, product_type: pt, discount_percent: pct });
        }
      }
    }

    const res = await fetch(`/api/portal-tiers/${selectedTier.id}/discounts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    setSavingDiscounts(false);
    if (!res.ok) {
      const d = await res.json();
      setDiscountError(d.error ?? 'Save failed');
    } else {
      setDiscountSaved(true);
      setTimeout(() => setDiscountSaved(false), 3000);
    }
  }

  function setCell(uob: string, pt: string, val: string) {
    setDiscountDraft((prev) => ({ ...prev, [gridKey(uob, pt)]: val }));
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* ── Left: tier list ── */}
      <div className="flex-1 min-w-0 p-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">Portal Tiers</h1>
            <p className="text-sm text-gray-500 mt-1">
              Configure discount tiers for customer portal access.
            </p>
          </div>
          {!addingNew && (
            <button
              onClick={() => { setAddingNew(true); setNewName(''); setAddError(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Tier
            </button>
          )}
        </div>

        {/* Add-new form */}
        {addingNew && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-qm-lime bg-qm-lime-light/30 px-4 py-3">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTier(); if (e.key === 'Escape') setAddingNew(false); }}
              placeholder="Tier name (e.g. Government)"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
            />
            {addError && <span className="text-xs text-red-600">{addError}</span>}
            <button
              onClick={addTier}
              disabled={addSaving}
              className="rounded-md bg-qm-lime px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {addSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setAddingNew(false)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400 py-12 text-center">Loading tiers…</div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Customers</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tiers.map((tier) => (
                  <tr
                    key={tier.id}
                    onClick={() => openTier(tier)}
                    className={`cursor-pointer transition-colors ${
                      selectedTier?.id === tier.id ? 'bg-qm-lime-light' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-gray-900">{tier.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          tier.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {tier.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {tier.customer_count > 0 ? (
                        <span className="font-medium text-gray-700">{tier.customer_count}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleActive(tier)}
                        disabled={toggling[tier.id]}
                        title={tier.is_active ? 'Deactivate' : 'Activate'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                          tier.is_active ? 'bg-qm-lime' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            tier.is_active ? 'translate-x-[18px]' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
                {tiers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">No tiers yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Right: discount grid slide-over ── */}
      {selectedTier && (
        <div className="w-[700px] shrink-0 border-l border-gray-200 bg-white flex flex-col sticky top-0 h-screen overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <div>
              <p className="text-base font-bold text-gray-900">{selectedTier.name}</p>
              <p className="text-xs text-gray-400">Discount percentages by business unit × product type</p>
            </div>
            <button
              onClick={() => setSelectedTier(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Grid scroll area */}
          <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
            {discountError && (
              <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between">
                {discountError}
                <button onClick={() => setDiscountError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
              </div>
            )}

            {loadingDiscounts ? (
              <div className="py-16 text-center text-sm text-gray-400">Loading discounts…</div>
            ) : productTypes.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">
                No product types configured. Add some under Settings → Product Types.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse min-w-max">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-500 min-w-[140px]">
                        Business Unit
                      </th>
                      {productTypes.map((pt) => (
                        <th
                          key={pt}
                          className="border border-gray-200 px-2 py-2 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[80px]"
                        >
                          {pt}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {UOB_KEYS.map((uob) => (
                      <tr key={uob} className="hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                          {UOB_LABELS[uob]}
                        </td>
                        {productTypes.map((pt) => {
                          const key = gridKey(uob, pt);
                          const val = discountDraft[key] ?? '';
                          return (
                            <td key={pt} className="border border-gray-200 p-1 text-center">
                              <div className="relative flex items-center justify-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.5"
                                  value={val}
                                  onChange={(e) => setCell(uob, pt, e.target.value)}
                                  placeholder="0"
                                  className="w-16 rounded border border-gray-200 px-1.5 py-1 text-center text-xs focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                                />
                                <span className="absolute right-1 text-gray-400 text-[10px] pointer-events-none">%</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
            {discountSaved && <span className="text-sm font-medium text-green-600">Saved</span>}
            <button
              onClick={saveDiscounts}
              disabled={savingDiscounts || loadingDiscounts}
              className="rounded-lg bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {savingDiscounts ? 'Saving…' : 'Save Grid'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
