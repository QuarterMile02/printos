'use client';

import { useState, useEffect } from 'react';

interface Props {
  userId: string;
  orgId: string;
  userRole: string;
  slug: string;
}

type ConceptStatus = 'pending' | 'in_progress' | 'waiting_on_customer' | 'approved' | 'declined' | 'completed';

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

function IconCheck() {
  return (
    <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function StatPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${color}`}>
      <span className="text-base font-bold">{count}</span>
      <span>{label}</span>
    </div>
  );
}

export default function TasksPageClient({ userId, slug }: Props) {
  const [filter, setFilter] = useState<'mine' | 'all' | 'overdue' | 'concepts'>('mine');
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter === 'mine') params.set('assigned_to', userId);
    if (filter === 'overdue') params.set('status', 'open');
    const res = await fetch(`/api/tasks?${params}`);
    const data = await res.json();
    let result = Array.isArray(data) ? data : [];
    if (filter === 'overdue') {
      result = result.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());
    }
    if (filter === 'concepts') {
      result = result.filter((t: any) => t.task_type?.is_concept === true);
    }
    setTasks(result);
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, [filter]);

  const open = tasks.filter(t => t.status !== 'done');

  // Concept metrics (client-side count)
  const conceptApproved = tasks.filter(t => t.concept_status === 'approved').length;
  const conceptDeclined = tasks.filter(t => t.concept_status === 'declined').length;
  const conceptConverted = tasks.filter(t => t.converted_to_quote_at).length;

  const FILTER_LABELS: Record<typeof filter, string> = {
    mine: 'My Tasks',
    all: 'All Tasks',
    overdue: 'Overdue',
    concepts: 'Concepts',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75" />
          </svg>
          <h1 className="text-lg font-bold text-gray-900">Tasks</h1>
          {open.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
              {open.length} open
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['mine', 'all', 'overdue', 'concepts'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {/* Concepts metrics strip */}
        {filter === 'concepts' && !loading && tasks.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            <StatPill label="Total" count={tasks.length} color="bg-gray-100 text-gray-700" />
            <StatPill label="Approved" count={conceptApproved} color="bg-green-100 text-green-700" />
            <StatPill label="Declined" count={conceptDeclined} color="bg-red-100 text-red-600" />
            <StatPill label="Converted to Quote" count={conceptConverted} color="bg-blue-100 text-blue-700" />
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-12">
            {filter === 'overdue'
              ? 'No overdue tasks. Great job!'
              : filter === 'concepts'
                ? 'No concept tasks found.'
                : 'No tasks found.'}
          </div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {tasks.map((task: any) => {
              const isConcept = task.task_type?.is_concept === true;
              const cs = task.concept_status as ConceptStatus | undefined;
              const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();
              return (
                <div
                  key={task.id}
                  className={`p-4 rounded-lg border bg-white ${
                    isOverdue
                      ? 'border-red-200'
                      : isConcept
                        ? 'border-l-4 border-l-amber-400 border-gray-200'
                        : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {task.status === 'done'
                        ? <IconCheck />
                        : task.status === 'in_progress'
                          ? <IconAlert />
                          : <IconClock />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-semibold ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {task.title}
                        </p>
                        {task.task_type && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            {task.task_type.name}
                          </span>
                        )}
                        {isConcept && cs ? (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${CONCEPT_STATUS_COLORS[cs]}`}>
                            {CONCEPT_STATUS_LABELS[cs]}
                          </span>
                        ) : null}
                        {task.sample_work_order_id && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                            SWO →
                          </span>
                        )}
                      </div>
                      {task.description && <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        {task.due_date && (
                          <span className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                            Due {new Date(task.due_date + 'T00:00:00').toLocaleDateString()}
                          </span>
                        )}
                        {task.assigned_profile && <span>→ {task.assigned_profile.full_name}</span>}
                        {!isConcept && (
                          <span className={`capitalize font-medium ${
                            task.priority === 'high' ? 'text-red-500' : task.priority === 'medium' ? 'text-amber-500' : 'text-gray-400'
                          }`}>{task.priority}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
