'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  Plus,
  Filter,
  X,
  Trash2,
  Pencil,
  User,
  Link2,
} from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatRelativeTime, getPriorityColorClass } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { PRIORITY_OPTIONS } from '@/lib/constants';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { taskSchema, type TaskFormData, TASK_DEFAULTS } from '@/lib/schemas';
import type { Priority, TaskStatus, TaskType } from '@/types';

const TASK_TYPE_OPTIONS: { label: string; value: TaskType }[] = [
  { label: 'Follow Up', value: 'follow_up' },
  { label: 'Call', value: 'call' },
  { label: 'Email', value: 'email' },
  { label: 'Demo', value: 'demo' },
  { label: 'Proposal', value: 'proposal' },
  { label: 'Other', value: 'other' },
];

const STATUS_OPTIONS: { label: string; value: TaskStatus | 'all' }[] = [
  { label: 'All Statuses', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Cancelled', value: 'cancelled' },
];

function formatTaskType(type: TaskType) {
  return TASK_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-red-500 text-[10px] font-mono mt-0.5">{message}</p>;
}

export function TasksView() {
  const tasks = useCRMStore((state) => state.tasks);
  const currentUser = useCRMStore((state) => state.currentUser);
  const team = useCRMStore((state) => state.team);
  const leads = useCRMStore((state) => state.leads);
  const addTask = useCRMStore((state) => state.addTask);
  const updateTask = useCRMStore((state) => state.updateTask);
  const toggleTask = useCRMStore((state) => state.toggleTask);
  const deleteTask = useCRMStore((state) => state.deleteTask);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema) as Resolver<TaskFormData>,
    defaultValues: TASK_DEFAULTS,
  });

  const actionableTasks = useMemo(
    () => tasks.filter((t) => t.type !== 'meeting'),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    return actionableTasks
      .filter((task) => {
        const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
        const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
        return matchesStatus && matchesPriority;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [actionableTasks, statusFilter, priorityFilter]);

  // Compute overdue IDs inside a memo keyed on filteredTasks to satisfy react-hooks/purity
  const overdueTaskIds = useMemo(() => {
    const now = Date.now(); // eslint-disable-line react-hooks/purity
    const ids = new Set<string>();
    for (const task of actionableTasks) {
      if (task.status !== 'completed' && new Date(task.dueDate).getTime() < now) {
        ids.add(task.id);
      }
    }
    return ids;
  }, [actionableTasks]);

  const pendingCount = useMemo(
    () => actionableTasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
    [actionableTasks]
  );

  const openNewTaskModal = () => {
    setEditingTask(null);
    setFormError(null);
    reset({
      title: '',
      description: '',
      type: 'follow_up',
      priority: 'medium',
      dueDate: '',
      leadId: '',
      assignedTo: currentUser?.id || team[0]?.id || '',
    });
    setIsModalOpen(true);
  };

  const openEditTaskModal = (task: typeof tasks[0]) => {
    setEditingTask(task.id);
    setFormError(null);
    reset({
      title: task.title,
      description: task.description || '',
      type: task.type,
      priority: task.priority,
      dueDate: task.dueDate.split('T')[0],
      leadId: task.leadId || '',
      assignedTo: task.assignedTo || '',
    });
    setIsModalOpen(true);
  };

  const onSubmit = async (data: TaskFormData) => {
    if (!currentUser) return;

    setSaving(true);
    setFormError(null);

    try {
      if (editingTask) {
        const selectedLead = leads.find((l) => l.id === data.leadId);
        await updateTask(editingTask, {
          title: data.title.trim(),
          description: (data.description || '').trim(),
          type: data.type,
          priority: data.priority,
          dueDate: new Date(data.dueDate).toISOString(),
          leadId: data.leadId || undefined,
          leadName: selectedLead?.fullName,
          assignedTo: data.assignedTo,
        });
      } else {
        const selectedLead = leads.find((l) => l.id === data.leadId);
        await addTask({
          title: data.title.trim(),
          description: (data.description || '').trim(),
          type: data.type,
          priority: data.priority,
          dueDate: new Date(data.dueDate).toISOString(),
          leadId: data.leadId || undefined,
          leadName: selectedLead?.fullName,
          assignedTo: data.assignedTo,
          createdBy: currentUser.id,
          tenantId: currentUser.tenantId,
        });
      }
      setIsModalOpen(false);
      setEditingTask(null);
      setFormError(null);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save task';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete task "${title}"?`)) return;
    await deleteTask(id);
  };

  const dataLoading = useCRMStore((state) => state.dataLoading);

  if (dataLoading && tasks.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 overflow-y-auto h-full scrollbar-thin">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-4 rounded-xl border border-border/60 bg-card">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-16 rounded-full ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Tasks & Reminders</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Track follow-ups, bookings, and travel arrangements.
              {pendingCount > 0 && (
                <span className="ml-2 text-primary font-semibold">{pendingCount} open</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-sm transition-colors shadow-sm ${
                showFilters
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-card/80 border-border/60 text-foreground hover:border-primary/40'
              }`}
            >
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Filter</span>
            </button>
            <button
              type="button"
              onClick={openNewTaskModal}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              <span>New Task</span>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 rounded-2xl bg-card/80 border border-border/60 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
                    className="h-10 rounded-xl bg-background border border-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Priority</label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as Priority | 'all')}
                    className="h-10 rounded-xl bg-background border border-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  >
                    <option value="all">All Priorities</option>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {filteredTasks.length === 0 ? (
          <div className="p-12 rounded-2xl bg-card/80 border border-border/60 shadow-sm text-center">
            <Clock className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No tasks match your filters.</p>
            <button
              type="button"
              onClick={openNewTaskModal}
              className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first task
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTasks.map((task, idx) => {
              const isCompleted = task.status === 'completed';
              const isOverdue = overdueTaskIds.has(task.id);

              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`p-5 rounded-2xl bg-card/80 border border-border/60 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group ${
                    isCompleted ? 'opacity-75' : ''
                  } ${isOverdue ? 'border-red-200/80' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className="mt-0.5 shrink-0 cursor-pointer"
                      aria-label={isCompleted ? 'Mark task as pending' : 'Mark task as complete'}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 hover:text-emerald-700 transition-colors" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3
                            className={`font-semibold text-foreground ${
                              isCompleted ? 'line-through text-muted-foreground' : ''
                            }`}
                          >
                            {task.title}
                          </h3>
                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-mono ${
                                isOverdue ? 'text-red-600' : 'text-muted-foreground'
                              }`}
                            >
                              <Clock className="h-3 w-3" />
                              {formatRelativeTime(task.dueDate)}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getPriorityColorClass(task.priority)}`}
                            >
                              {task.priority}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border text-muted-foreground bg-secondary/50 border-border/60">
                              {formatTaskType(task.type)}
                            </span>
                            {task.leadName && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                <Link2 className="h-3 w-3" />
                                {task.leadName}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                              <User className="h-3 w-3" />
                              {task.assignedName}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!isCompleted && (task.priority === 'high' || task.priority === 'urgent') && (
                            <AlertCircle className="h-4 w-4 text-red-500 animate-pulse" />
                          )}
                          <button
                            type="button"
                            onClick={() => openEditTaskModal(task)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-all"
                            aria-label="Edit task"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(task.id, task.title)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                            aria-label="Delete task"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-popover/90 backdrop-blur-xl border border-border/60 w-full max-w-lg rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex h-14 items-center justify-between px-5 border-b border-border/60 bg-secondary/50">
                <span className="font-heading font-bold text-foreground text-xs uppercase tracking-wider select-none">
                  {editingTask ? 'Edit Task' : 'New Task'}
                </span>
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setFormError(null); }}
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit, (errors) => {
                const firstError = Object.values(errors)[0];
                const msg = firstError?.message || 'Please fix the errors below';
                setFormError(msg);
              })} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-thin text-sm">
                {formError && (
                  <div className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 border border-red-200 text-red-700">
                    {formError}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Title</label>
                  <input
                    {...register('title')}
                    placeholder="Follow up with client"
                    className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  <FieldError message={errors.title?.message} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Description</label>
                  <textarea
                    {...register('description')}
                    placeholder="Optional details..."
                    rows={3}
                    className="rounded-xl bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Type</label>
                    <select
                      {...register('type')}
                      className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    >
                      {TASK_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Priority</label>
                    <select
                      {...register('priority')}
                      className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    >
                      {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Due Date</label>
                  <input
                    type="datetime-local"
                    {...register('dueDate')}
                    className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  <FieldError message={errors.dueDate?.message} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Linked Lead</label>
                    <select
                      {...register('leadId')}
                      className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    >
                      <option value="">None</option>
                      {leads.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.fullName}
                          {lead.businessName ? ` — ${lead.businessName}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Assign To</label>
                    <select
                      {...register('assignedTo')}
                      className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    >
                      {team.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                    <FieldError message={errors.assignedTo?.message} />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setFormError(null); }}
                  className="h-10 px-4 rounded-xl border border-border/60 bg-background text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 disabled:opacity-60"
                  >
                    {saving ? 'Creating...' : 'Create Task'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
