'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Stage {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_won: boolean;
  is_lost: boolean;
}

interface Lead {
  id: string;
  title: string;
  stage_id: string | null;
  estimated_value: number | null;
  next_contact_date: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  lost_at: string | null;
  customer: { id: string; company_name: string | null; first_name: string; last_name: string } | null;
  assigned_profile: { id: string; full_name: string } | null;
}

interface Customer {
  id: string;
  company_name: string | null;
  first_name: string;
  last_name: string;
}

interface TeamMember {
  id: string;
  full_name: string;
}

interface Props {
  userId: string;
  orgId: string;
  slug: string;
}

const SOURCES = ['Walk-in', 'Phone', 'Website', 'Referral', 'GHL', 'Trade Show', 'Other'];

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtValue(v: number) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function customerLabel(c: Lead['customer']) {
  if (!c) return null;
  return c.company_name || `${c.first_name} ${c.last_name}`.trim();
}

export default function LeadsPageClient({ userId, orgId, slug }: Props) {
  const router = useRouter();
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [filter, setFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [loading, setLoading] = useState(true);

  // Drag state
  const draggingLeadId = useRef<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  // New lead modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    customer_id: '',
    assigned_to: '',
    stage_id: '',
    estimated_value: '',
    source: '',
    next_contact_date: '',
    notes: '',
  });
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerLabel_, setCustomerLabel_] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Won/Lost modals
  const [wonConfirm, setWonConfirm] = useState<{ lead: Lead; stageId: string } | null>(null);
  const [lostModal, setLostModal] = useState<{ lead: Lead; stageId: string } | null>(null);
  const [lostReason, setLostReason] = useState('');

  const fetchStages = async () => {
    const res = await fetch('/api/pipeline-stages');
    const data = await res.json();
    setStages(Array.isArray(data) ? data.sort((a: Stage, b: Stage) => a.sort_order - b.sort_order) : []);
  };

  const fetchLeads = async () => {
    const res = await fetch('/api/sales-leads');
    const data = await res.json();
    setLeads(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const fetchTeam = async () => {
    const res = await fetch('/api/team');
    const data = await res.json();
    setTeamMembers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchStages();
    fetchLeads();
    fetchTeam();
  }, []);

  const searchCustomers = useCallback((q: string) => {
    if (customerSearchTimer.current) clearTimeout(customerSearchTimer.current);
    customerSearchTimer.current = setTimeout(async () => {
      if (!q.trim()) { setCustomerResults([]); return; }
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      setCustomerResults(Array.isArray(data) ? data : []);
      setShowCustomerDropdown(true);
    }, 300);
  }, []);

  const moveLead = async (leadId: string, stageId: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: stageId } : l));
    await fetch(`/api/sales-leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: stageId }),
    });
    fetchLeads();
  };

  const handleDrop = (e: React.DragEvent, stage: Stage) => {
    e.preventDefault();
    setDragOverStageId(null);
    const leadId = draggingLeadId.current;
    if (!leadId) return;
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.stage_id === stage.id) return;

    if (stage.is_won) {
      setWonConfirm({ lead, stageId: stage.id });
    } else if (stage.is_lost) {
      setLostReason('');
      setLostModal({ lead, stageId: stage.id });
    } else {
      moveLead(leadId, stage.id);
    }
  };

  const confirmWon = async (createSO: boolean) => {
    if (!wonConfirm) return;
    await fetch(`/api/sales-leads/${wonConfirm.lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: wonConfirm.stageId }),
    });
    setWonConfirm(null);
    if (createSO) {
      router.push(`/dashboard/${slug}/sales-orders/new?from_lead=${wonConfirm.lead.id}`);
    } else {
      fetchLeads();
    }
  };

  const confirmLost = async () => {
    if (!lostModal) return;
    await fetch(`/api/sales-leads/${lostModal.lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: lostModal.stageId, lost_reason: lostReason || null }),
    });
    setLostModal(null);
    setLostReason('');
    fetchLeads();
  };

  const saveNewLead = async () => {
    if (!form.title.trim()) return;
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      stage_id: form.stage_id || null,
      assigned_to: form.assigned_to || null,
      customer_id: form.customer_id || null,
      source: form.source || null,
      next_contact_date: form.next_contact_date || null,
      notes: form.notes || null,
      estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
    };
    const res = await fetch('/api/sales-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setShowModal(false);
      resetForm();
      fetchLeads();
    }
  };

  const resetForm = () => {
    setForm({ title: '', customer_id: '', assigned_to: '', stage_id: '', estimated_value: '', source: '', next_contact_date: '', notes: '' });
    setCustomerSearch('');
    setCustomerLabel_('');
    setCustomerResults([]);
  };

  const filteredLeads = leads.filter(l => {
    if (filter === 'mine') return l.assigned_profile?.id === userId;
    if (filter === 'unassigned') return !l.assigned_profile;
    return true;
  });

  // Unassigned leads go in the first column (stage_id = null)
  const leadsInStage = (stageId: string) =>
    filteredLeads.filter(l => l.stage_id === stageId);
  const unstagedLeads = filteredLeads.filter(l => !l.stage_id);

  const activeLeads = leads.filter(l => !l.won_at && !l.lost_at);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
          </svg>
          <h1 className="text-lg font-bold text-gray-900">Sales Leads</h1>
          {activeLeads.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {activeLeads.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['all', 'mine', 'unassigned'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Unassigned'}
              </button>
            ))}
          </div>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="flex items-center gap-1.5 bg-qm-lime hover:brightness-110 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Lead
          </button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex gap-4 p-6 h-full min-w-max">
          {loading ? (
            <div className="flex items-center justify-center w-full text-sm text-gray-400">Loading...</div>
          ) : stages.length === 0 ? (
            <div className="flex items-center justify-center w-full text-sm text-gray-400">No pipeline stages configured.</div>
          ) : (
            stages.map((stage, idx) => {
              const cards = idx === 0 ? [...unstagedLeads, ...leadsInStage(stage.id)] : leadsInStage(stage.id);
              const isDragOver = dragOverStageId === stage.id;
              return (
                <div
                  key={stage.id}
                  className={`flex-shrink-0 w-72 flex flex-col rounded-xl border transition-all ${
                    isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOverStageId(stage.id); }}
                  onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverStageId(null);
                    }
                  }}
                  onDrop={e => handleDrop(e, stage)}
                >
                  {/* Column header */}
                  <div className="px-3 pt-3 pb-2 border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                      <span className="text-sm font-bold text-gray-700 truncate">{stage.name}</span>
                      <span className="ml-auto text-xs text-gray-400 bg-white rounded-full px-2 py-0.5 font-semibold border border-gray-200">
                        {cards.length}
                      </span>
                    </div>
                  </div>
                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
                    {cards.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onDragStart={() => { draggingLeadId.current = lead.id; }}
                        onDragEnd={() => { draggingLeadId.current = null; setDragOverStageId(null); }}
                      />
                    ))}
                    {cards.length === 0 && (
                      <div className="text-xs text-gray-300 text-center py-6 select-none">Drop here</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* New Lead Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-gray-200">
              <h3 className="text-base font-bold text-gray-900">New Lead</h3>
            </div>
            <div className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                  placeholder="Lead title or project description"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  autoFocus
                />
              </div>

              {/* Customer search */}
              <div className="relative">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Customer</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                  placeholder="Search by company or name..."
                  value={customerLabel_ || customerSearch}
                  onChange={e => {
                    const v = e.target.value;
                    setCustomerSearch(v);
                    setCustomerLabel_('');
                    setForm(f => ({ ...f, customer_id: '' }));
                    searchCustomers(v);
                  }}
                  onFocus={() => { if (customerResults.length > 0) setShowCustomerDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                />
                {showCustomerDropdown && customerResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {customerResults.map(c => {
                      const label = c.company_name || `${c.first_name} ${c.last_name}`.trim();
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex flex-col"
                          onMouseDown={() => {
                            setForm(f => ({ ...f, customer_id: c.id }));
                            setCustomerLabel_(label);
                            setCustomerSearch('');
                            setShowCustomerDropdown(false);
                          }}
                        >
                          <span className="font-medium text-gray-900">{label}</span>
                          {c.company_name && (
                            <span className="text-xs text-gray-400">{c.first_name} {c.last_name}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Assigned To */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assigned To</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.assigned_to}
                    onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.map(m => (
                      <option key={m.id} value={m.id}>{m.full_name}</option>
                    ))}
                  </select>
                </div>
                {/* Stage */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Stage</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.stage_id}
                    onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))}
                  >
                    <option value="">— Select stage —</option>
                    {stages.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Estimated Value */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Estimated Value</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full border border-gray-300 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                      placeholder="0"
                      value={form.estimated_value}
                      onChange={e => setForm(f => ({ ...f, estimated_value: e.target.value }))}
                    />
                  </div>
                </div>
                {/* Source */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Source</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.source}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                  >
                    <option value="">— Select —</option>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Next Contact Date */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Next Contact Date</label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                  value={form.next_contact_date}
                  onChange={e => setForm(f => ({ ...f, next_contact_date: e.target.value }))}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime resize-none"
                  placeholder="Notes, context, follow-up details..."
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="px-6 pb-6 flex justify-end gap-2">
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveNewLead}
                className="px-4 py-2 text-sm bg-qm-lime hover:brightness-110 text-white font-semibold rounded-lg transition-colors"
              >
                Create Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Won Confirm Modal */}
      {wonConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-gray-900">Mark as Won?</h3>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-medium text-gray-700">{wonConfirm.lead.title}</span> will be marked as won.
              </p>
            </div>
            <p className="text-sm text-center text-gray-600">Would you like to create a Sales Order from this lead?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => confirmWon(true)}
                className="w-full py-2 text-sm bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
              >
                Mark as Won + Create Sales Order
              </button>
              <button
                onClick={() => confirmWon(false)}
                className="w-full py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg transition-colors"
              >
                Just Mark as Won
              </button>
              <button
                onClick={() => setWonConfirm(null)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lost Reason Modal */}
      {lostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900">Why was this lead lost?</h3>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-700">{lostModal.lead.title}</span>
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime resize-none"
              placeholder="Reason (optional)..."
              rows={3}
              value={lostReason}
              onChange={e => setLostReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setLostModal(null); setLostReason(''); }}
                className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLost}
                className="flex-1 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
              >
                Mark as Lost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead, onDragStart, onDragEnd }: {
  lead: Lead;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const company = customerLabel(lead.customer);
  const isOverdue = lead.next_contact_date && !lead.won_at && !lead.lost_at &&
    new Date(lead.next_contact_date) < new Date();

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md hover:border-gray-300 transition-all select-none"
    >
      <p className="text-sm font-semibold text-gray-900 leading-snug">{lead.title}</p>
      {company && (
        <p className="text-xs text-gray-500 mt-0.5 truncate">{company}</p>
      )}
      {lead.estimated_value != null && lead.estimated_value > 0 && (
        <p className="text-xs font-bold text-green-600 mt-1">{fmtValue(lead.estimated_value)}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        {lead.assigned_profile && (
          <span className="text-xs text-gray-400 truncate max-w-[120px]">{lead.assigned_profile.full_name}</span>
        )}
        {lead.next_contact_date && (
          <span className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-400'}`}>
            {fmtDate(lead.next_contact_date)}
          </span>
        )}
      </div>
      <p className="text-[10px] text-gray-300 mt-1.5">{daysSince(lead.created_at)}d ago</p>
    </div>
  );
}
