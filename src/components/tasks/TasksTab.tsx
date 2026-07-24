'use client';

import React, { useState, useEffect, useRef } from 'react';

type ConceptStatus = 'pending' | 'in_progress' | 'waiting_on_customer' | 'approved' | 'declined' | 'completed';

interface TaskType {
  id: string;
  name: string;
  is_concept: boolean;
  is_system: boolean;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  due_date?: string;
  assigned_to?: string;
  assigned_profile?: { id: string; full_name: string };
  created_at: string;
  completed_at?: string;
  task_type_id?: string;
  task_type?: { id: string; name: string; is_concept: boolean };
  concept_status?: ConceptStatus;
  product_id?: string;
  product?: { id: string; name: string };
  departments?: string[];
  is_sample_work_order?: boolean;
  sample_work_order_id?: string;
  converted_to_quote_at?: string;
}

interface TeamMember {
  id: string;
  full_name: string;
}

interface TasksTabProps {
  jobId?: string;
  soId?: string;
  invoiceId?: string;
}

const PRIORITY_COLORS = {
  low: 'text-gray-500 bg-gray-100',
  medium: 'text-amber-700 bg-amber-100',
  high: 'text-red-700 bg-red-100',
};

const CONCEPT_STATUS_LABELS: Record<ConceptStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  waiting_on_customer: 'Waiting on Customer',
  approved: 'Approved',
  declined: 'Declined',
  completed: 'Completed',
};

const CONCEPT_STATUS_COLORS: Record<ConceptStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_on_customer: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-600',
  completed: 'bg-gray-200 text-gray-700',
};

const CONCEPT_DEPARTMENTS = [
  { value: 'large_format', label: 'Large Format' },
  { value: 'commercial_print', label: 'Commercial Print' },
  { value: 'vehicle_wrap', label: 'Vehicle Wrap' },
  { value: 'channel_letters', label: 'Channel Letters' },
  { value: 'fabrication', label: 'Fabrication' },
  { value: 'installation', label: 'Installation' },
  { value: 'service_repair', label: 'Service/Repair' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'digital_screens', label: 'Digital Screens' },
];

function IconPlus() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'h-3.5 w-3.5'} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg className="h-3.5 w-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'h-3.5 w-3.5'} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

const STATUS_ICONS: Record<string, React.ReactElement> = {
  open: <IconClock />,
  in_progress: <IconAlert />,
  done: <IconCheck className="h-3.5 w-3.5 text-green-500" />,
};

export default function TasksTab({ jobId, soId, invoiceId }: TasksTabProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'open',
    due_date: '',
    assigned_to: '',
    task_type_id: '',
    concept_status: 'pending' as ConceptStatus,
    departments: [] as string[],
    product_id: '',
  });

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<{ id: string; name: string }[]>([]);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [productDisplayName, setProductDisplayName] = useState('');
  const productRef = useRef<HTMLDivElement>(null);

  // New custom type inline form
  const [showNewType, setShowNewType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeIsConcept, setNewTypeIsConcept] = useState(false);
  const [savingNewType, setSavingNewType] = useState(false);

  // SWO state
  const [swoCreating, setSwoCreating] = useState(false);
  const [swoCreated, setSwoCreated] = useState(false);

  const descRef = useRef<HTMLTextAreaElement>(null);

  const fetchTasks = async () => {
    const params = new URLSearchParams();
    if (jobId) params.set('job_id', jobId);
    if (soId) params.set('so_id', soId);
    const res = await fetch(`/api/tasks?${params}`);
    const data = await res.json();
    setTasks(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const fetchTeam = async () => {
    const res = await fetch('/api/team');
    const data = await res.json();
    setTeamMembers(Array.isArray(data) ? data : []);
  };

  const fetchTaskTypes = async () => {
    const res = await fetch('/api/task-types');
    const data = await res.json();
    setTaskTypes(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    fetchTasks();
    fetchTeam();
    fetchTaskTypes();
  }, [jobId, soId]);

  // Debounced product search
  useEffect(() => {
    if (!productSearch) { setProductResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(productSearch)}`);
      const data = await res.json();
      setProductResults(Array.isArray(data) ? data : []);
      setProductDropdownOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  // Close product dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (productRef.current && !productRef.current.contains(e.target as Node)) {
        setProductDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selectedTaskType = taskTypes.find(t => t.id === form.task_type_id);
  const isConcept = selectedTaskType?.is_concept === true;
  const isSampleBuild = selectedTaskType?.name === 'Sample Build';

  const openNew = () => {
    setEditTask(null);
    setForm({ title: '', description: '', priority: 'medium', status: 'open', due_date: '', assigned_to: '', task_type_id: '', concept_status: 'pending', departments: [], product_id: '' });
    setProductSearch('');
    setProductDisplayName('');
    setProductResults([]);
    setSwoCreated(false);
    setShowNewType(false);
    setShowModal(true);
  };

  const openEdit = (task: Task) => {
    setEditTask(task);
    setForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      status: task.status,
      due_date: task.due_date || '',
      assigned_to: task.assigned_to || '',
      task_type_id: task.task_type_id || '',
      concept_status: (task.concept_status as ConceptStatus) || 'pending',
      departments: task.departments || [],
      product_id: task.product_id || '',
    });
    setProductSearch('');
    setProductDisplayName(task.product?.name || '');
    setProductResults([]);
    setSwoCreated(!!task.sample_work_order_id);
    setShowNewType(false);
    setShowModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return;
    const body: Record<string, unknown> = {
      title: form.title,
      description: form.description,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      assigned_to: form.assigned_to || null,
      task_type_id: form.task_type_id || null,
      concept_status: isConcept ? form.concept_status : null,
      product_id: form.product_id || null,
      departments: form.departments,
    };
    if (!editTask) {
      if (jobId) body.job_id = jobId;
      if (soId) body.so_id = soId;
      if (invoiceId) body.invoice_id = invoiceId;
    }

    const url = editTask ? `/api/tasks/${editTask.id}` : '/api/tasks';
    const method = editTask ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { setShowModal(false); fetchTasks(); }
  };

  const toggleStatus = async (task: Task) => {
    const next = task.status === 'done' ? 'open' : task.status === 'open' ? 'in_progress' : 'done';
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    fetchTasks();
  };

  const deleteTask = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    fetchTasks();
  };

  const saveNewType = async () => {
    if (!newTypeName.trim()) return;
    setSavingNewType(true);
    const res = await fetch('/api/task-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTypeName.trim(), is_concept: newTypeIsConcept }),
    });
    setSavingNewType(false);
    if (res.ok) {
      const created = await res.json() as TaskType;
      setTaskTypes(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(f => ({ ...f, task_type_id: created.id }));
      setShowNewType(false);
      setNewTypeName('');
      setNewTypeIsConcept(false);
    }
  };

  const createSWO = async () => {
    if (!editTask) return;
    setSwoCreating(true);
    const res = await fetch('/api/sample-work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: editTask.id,
        title: editTask.title,
        product_id: form.product_id || null,
        assigned_to: form.assigned_to || null,
        departments: form.departments,
        notes: form.description,
      }),
    });
    setSwoCreating(false);
    if (res.ok) {
      setSwoCreated(true);
      fetchTasks();
    }
  };

  const toggleDept = (val: string) => {
    setForm(f => ({
      ...f,
      departments: f.departments.includes(val)
        ? f.departments.filter(d => d !== val)
        : [...f.departments, val],
    }));
  };

  const open = tasks.filter(t => t.status !== 'done');
  const done = tasks.filter(t => t.status === 'done');

  const isOverdue = (task: Task) =>
    !!task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-700">Tasks</span>
          {open.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {open.length} open
            </span>
          )}
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1 text-xs bg-qm-lime hover:brightness-110 text-white font-semibold px-3 py-1.5 rounded-md transition-colors"
        >
          <IconPlus /> Add Task
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="text-sm text-gray-400 py-6 text-center border-2 border-dashed border-gray-200 rounded-lg">
          No tasks yet. Add one to track action items for this job.
        </div>
      ) : (
        <div className="space-y-2">
          {open.map(task => {
            const isConcept = task.task_type?.is_concept === true;
            const cs = task.concept_status;
            return (
              <div
                key={task.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:border-gray-300 transition-all ${
                  isOverdue(task)
                    ? 'border-red-200 bg-red-50'
                    : isConcept
                      ? 'border-l-4 border-l-amber-400 border-gray-200 bg-white'
                      : 'border-gray-200 bg-white'
                }`}
                onClick={() => openEdit(task)}
              >
                <button
                  className="mt-0.5 flex-shrink-0"
                  onClick={e => { e.stopPropagation(); toggleStatus(task); }}
                  title="Cycle status"
                >
                  {STATUS_ICONS[task.status]}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {task.title}
                    </span>
                    {task.task_type && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {task.task_type.name}
                      </span>
                    )}
                    {isConcept && cs ? (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${CONCEPT_STATUS_COLORS[cs]}`}>
                        {CONCEPT_STATUS_LABELS[cs]}
                      </span>
                    ) : (
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded capitalize ${PRIORITY_COLORS[task.priority]}`}>
                        {task.priority}
                      </span>
                    )}
                    {task.sample_work_order_id && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                        SWO →
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{task.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    {task.due_date && (
                      <span className={isOverdue(task) ? 'text-red-600 font-semibold' : ''}>
                        Due {new Date(task.due_date + 'T00:00:00').toLocaleDateString()}
                        {isOverdue(task) && ' — OVERDUE'}
                      </span>
                    )}
                    {task.assigned_profile && <span>→ {task.assigned_profile.full_name}</span>}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteTask(task.id); }}
                  className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors"
                >
                  <IconTrash />
                </button>
              </div>
            );
          })}

          {done.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none py-1">
                {done.length} completed task{done.length !== 1 ? 's' : ''}
              </summary>
              <div className="space-y-1 mt-1">
                {done.map(task => (
                  <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 bg-gray-50">
                    <IconCheck className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                    <span className="text-xs text-gray-400 line-through flex-1">{task.title}</span>
                    <button
                      onClick={() => toggleStatus(task)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Reopen
                    </button>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors"
                    >
                      <IconTrash className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <h3 className="text-base font-bold text-gray-900">{editTask ? 'Edit Task' : 'New Task'}</h3>

              {/* Task Type */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Task Type</label>
                {!showNewType ? (
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.task_type_id}
                    onChange={e => {
                      if (e.target.value === '_new') {
                        setShowNewType(true);
                      } else {
                        setForm(f => ({ ...f, task_type_id: e.target.value }));
                      }
                    }}
                  >
                    <option value="">— No type —</option>
                    {taskTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.is_concept ? ' ★' : ''}</option>
                    ))}
                    <option value="_new">+ New Custom Type…</option>
                  </select>
                ) : (
                  <div className="space-y-2 border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <input
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                      placeholder="Type name…"
                      value={newTypeName}
                      onChange={e => setNewTypeName(e.target.value)}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') saveNewType(); if (e.key === 'Escape') setShowNewType(false); }}
                    />
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTypeIsConcept}
                        onChange={e => setNewTypeIsConcept(e.target.checked)}
                        className="rounded"
                      />
                      Is a concept type (★)
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={saveNewType}
                        disabled={savingNewType || !newTypeName.trim()}
                        className="flex-1 bg-qm-lime hover:brightness-110 disabled:opacity-50 text-white text-xs font-semibold py-1.5 rounded-lg"
                      >
                        {savingNewType ? 'Saving…' : 'Save Type'}
                      </button>
                      <button
                        onClick={() => setShowNewType(false)}
                        className="px-3 text-xs text-gray-500 hover:bg-gray-100 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Title *</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                  placeholder="Task title"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  autoFocus={!showNewType}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                <textarea
                  ref={descRef}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime resize-none"
                  placeholder="Details, notes, context..."
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Due Date</label>
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    value={form.due_date}
                    onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Assign To</label>
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
              </div>

              {/* ── Concept Fields ── */}
              {isConcept && (
                <div className="border-t border-amber-200 pt-4 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">Concept Fields</p>

                  {/* Concept Status */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Concept Status</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                      value={form.concept_status}
                      onChange={e => setForm(f => ({ ...f, concept_status: e.target.value as ConceptStatus }))}
                    >
                      {(Object.entries(CONCEPT_STATUS_LABELS) as [ConceptStatus, string][]).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Product search */}
                  <div ref={productRef} className="relative">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Product (optional)</label>
                    {form.product_id && productDisplayName ? (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm text-gray-800 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
                          {productDisplayName}
                        </span>
                        <button
                          onClick={() => { setForm(f => ({ ...f, product_id: '' })); setProductDisplayName(''); setProductSearch(''); }}
                          className="text-gray-400 hover:text-red-400 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <input
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                        placeholder="Search products…"
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        onFocus={() => productSearch && setProductDropdownOpen(true)}
                      />
                    )}
                    {productDropdownOpen && productResults.length > 0 && !form.product_id && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {productResults.map(p => (
                          <button
                            key={p.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                            onClick={() => {
                              setForm(f => ({ ...f, product_id: p.id }));
                              setProductDisplayName(p.name);
                              setProductSearch('');
                              setProductDropdownOpen(false);
                            }}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Departments */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Departments</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CONCEPT_DEPARTMENTS.map(d => {
                        const checked = form.departments.includes(d.value);
                        return (
                          <label
                            key={d.value}
                            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                              checked
                                ? 'border-qm-lime bg-qm-lime-light text-qm-lime'
                                : 'border-gray-200 text-gray-600 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleDept(d.value)}
                            />
                            {d.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sample Work Order button */}
                  {isSampleBuild && editTask && !swoCreated && (
                    <button
                      onClick={createSWO}
                      disabled={swoCreating}
                      className="w-full border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 text-xs font-semibold py-2 rounded-lg transition-colors"
                    >
                      {swoCreating ? 'Creating…' : '+ Create Sample Work Order'}
                    </button>
                  )}
                  {swoCreated && (
                    <p className="text-xs text-center text-green-600 font-semibold">✓ Sample Work Order created</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="px-4 py-2 text-sm bg-qm-lime hover:brightness-110 text-white font-semibold rounded-lg transition-colors"
                >
                  {editTask ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
