'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Stage {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
}

interface Props {
  slug: string;
}

export default function SalesLeadsSettingsClient({ slug }: Props) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  // Drag to reorder
  const draggingIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const fetchStages = async () => {
    const res = await fetch('/api/pipeline-stages');
    const data = await res.json();
    setStages(Array.isArray(data) ? data.sort((a: Stage, b: Stage) => a.sort_order - b.sort_order) : []);
    setLoading(false);
  };

  useEffect(() => { fetchStages(); }, []);

  const patchStage = async (id: string, body: Partial<Stage>) => {
    setSaving(id);
    const res = await fetch(`/api/pipeline-stages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(null);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Save failed');
    } else {
      fetchStages();
    }
  };

  const saveInlineName = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    setEditingId(null);
    await patchStage(id, { name });
  };

  const toggleWon = async (stage: Stage) => {
    const alreadyHasWon = stages.some(s => s.is_won && s.id !== stage.id);
    if (!stage.is_won && alreadyHasWon) {
      setError('Only one stage can be marked as Won.');
      return;
    }
    await patchStage(stage.id, { is_won: !stage.is_won, is_lost: false });
  };

  const toggleLost = async (stage: Stage) => {
    const alreadyHasLost = stages.some(s => s.is_lost && s.id !== stage.id);
    if (!stage.is_lost && alreadyHasLost) {
      setError('Only one stage can be marked as Lost.');
      return;
    }
    await patchStage(stage.id, { is_lost: !stage.is_lost, is_won: false });
  };

  const deleteStage = async (stage: Stage) => {
    if (stage.is_won || stage.is_lost) {
      setError('Cannot delete a Won or Lost stage.');
      return;
    }
    if (!confirm(`Delete stage "${stage.name}"? Leads in this stage will become unassigned.`)) return;
    const res = await fetch(`/api/pipeline-stages/${stage.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? 'Delete failed');
    } else {
      fetchStages();
    }
  };

  const addStage = async () => {
    const name = newStageName.trim();
    if (!name) return;
    setAddingNew(true);
    const nextOrder = stages.length > 0 ? Math.max(...stages.map(s => s.sort_order)) + 1 : 0;
    const res = await fetch('/api/pipeline-stages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: '#6B7280', sort_order: nextOrder }),
    });
    setAddingNew(false);
    if (res.ok) {
      setNewStageName('');
      fetchStages();
    } else {
      const d = await res.json();
      setError(d.error ?? 'Add failed');
    }
  };

  // Drag reorder
  const handleDragStart = (idx: number) => { draggingIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };
  const handleDrop = async (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    setDragOverIdx(null);
    const fromIdx = draggingIdx.current;
    if (fromIdx === null || fromIdx === dropIdx) return;

    const reordered = [...stages];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(dropIdx, 0, moved);

    const updated = reordered.map((s, i) => ({ ...s, sort_order: i }));
    setStages(updated);

    // Persist new sort orders
    await Promise.all(
      updated.map((s, i) => {
        if (s.sort_order !== stages[i]?.sort_order) {
          return fetch(`/api/pipeline-stages/${s.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order: s.sort_order }),
          });
        }
        return Promise.resolve();
      })
    );
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900">Sales Leads Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">Configure the stages leads move through. Drag to reorder.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading stages...</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Stage Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 w-20">Color</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 w-16">Won</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 w-16">Lost</th>
                <th className="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stages.map((stage, idx) => (
                <tr
                  key={stage.id}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={e => handleDrop(e, idx)}
                  onDragEnd={() => { draggingIdx.current = null; setDragOverIdx(null); }}
                  className={`transition-colors ${dragOverIdx === idx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  {/* Drag handle */}
                  <td className="px-4 py-3 cursor-grab text-gray-300">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="9" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </td>

                  {/* Name — click to edit inline */}
                  <td className="px-4 py-3">
                    {editingId === stage.id ? (
                      <input
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-qm-lime"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => saveInlineName(stage.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveInlineName(stage.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        className="text-sm font-medium text-gray-800 hover:text-qm-lime text-left flex items-center gap-2"
                        onClick={() => { setEditingId(stage.id); setEditName(stage.name); }}
                      >
                        {stage.name}
                        {saving === stage.id && <span className="text-xs text-gray-400">saving…</span>}
                        <span className="text-xs text-gray-300 opacity-0 group-hover:opacity-100">✏</span>
                      </button>
                    )}
                  </td>

                  {/* Color swatch — click opens native color picker */}
                  <td className="px-4 py-3">
                    <label className="cursor-pointer inline-block">
                      <div
                        className="h-7 w-7 rounded-full border-2 border-white shadow-sm ring-1 ring-gray-200"
                        style={{ background: stage.color }}
                      />
                      <input
                        type="color"
                        className="sr-only"
                        value={stage.color}
                        onChange={e => {
                          setStages(prev => prev.map(s => s.id === stage.id ? { ...s, color: e.target.value } : s));
                        }}
                        onBlur={e => patchStage(stage.id, { color: e.target.value })}
                      />
                    </label>
                  </td>

                  {/* Won toggle */}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleWon(stage)}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                        stage.is_won
                          ? 'border-green-500 bg-green-500 text-white'
                          : 'border-gray-300 text-transparent hover:border-green-400'
                      }`}
                      title={stage.is_won ? 'Won stage (click to unset)' : 'Mark as Won stage'}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </button>
                  </td>

                  {/* Lost toggle */}
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleLost(stage)}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
                        stage.is_lost
                          ? 'border-red-500 bg-red-500 text-white'
                          : 'border-gray-300 text-transparent hover:border-red-400'
                      }`}
                      title={stage.is_lost ? 'Lost stage (click to unset)' : 'Mark as Lost stage'}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>

                  {/* Delete */}
                  <td className="px-4 py-3 text-right">
                    {!stage.is_won && !stage.is_lost ? (
                      <button
                        onClick={() => deleteStage(stage)}
                        className="text-gray-300 hover:text-red-400 transition-colors"
                        title="Delete stage"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300" title="Cannot delete Won/Lost stage">🔒</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add stage row */}
          <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-3 bg-gray-50">
            <input
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
              placeholder="New stage name..."
              value={newStageName}
              onChange={e => setNewStageName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStage(); }}
            />
            <button
              onClick={addStage}
              disabled={addingNew || !newStageName.trim()}
              className="flex items-center gap-1.5 bg-qm-lime hover:brightness-110 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Stage
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        Tip: Click a stage name to rename it. Click the color circle to change its color. Drag rows to reorder.
      </p>
    </div>
  );
}
