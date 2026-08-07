'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays,
  Clock,
  Users,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  User,
  LayoutGrid,
  Rows3,
  Square,
  MapPin,
  List,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatDate } from '@/lib/utils';
import type { Task } from '@/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

type CalendarViewMode = 'month' | 'week' | 'day';

function getPriorityEventColor(priority: string) {
  switch (priority) {
    case 'urgent':
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-blue-500';
    case 'low':
      return 'bg-emerald-500';
    default:
      return 'bg-primary';
  }
}

function buildCalendarDays(viewDate: Date): Date[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const leadingEmpty = firstOfMonth.getDay();
  const days: Date[] = [];

  for (let i = leadingEmpty - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  for (let day = 1; day <= lastOfMonth.getDate(); day++) {
    days.push(new Date(year, month, day));
  }
  while (days.length % 7 !== 0) {
    const trailingDay = days.length - leadingEmpty - lastOfMonth.getDate() + 1;
    days.push(new Date(year, month + 1, trailingDay));
  }
  while (days.length < 42) {
    const trailingDay = days.length - leadingEmpty - lastOfMonth.getDate() + 1;
    days.push(new Date(year, month + 1, trailingDay));
  }
  return days;
}

function getWeekDays(viewDate: Date): Date[] {
  const start = new Date(viewDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatEventTime(dueDate: string) {
  return new Date(dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getHourFromDate(dueDate: string): number {
  return new Date(dueDate).getHours();
}

const emptyMeetingForm = () => ({
  title: '',
  leadId: '',
  dueDate: '',
  description: '',
});

export function CalendarView() {
  const tasks = useCRMStore((state) => state.tasks);
  const currentUser = useCRMStore((state) => state.currentUser);
  const leads = useCRMStore((state) => state.leads);
  const addMeeting = useCRMStore((state) => state.addMeeting);
  const updateTask = useCRMStore((state) => state.updateTask);
  const deleteTask = useCRMStore((state) => state.deleteTask);
  const [editingMeeting, setEditingMeeting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedMeeting, setSelectedMeeting] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyMeetingForm);

  const meetings = useMemo(() => tasks.filter((t) => t.type === 'meeting'), [tasks]);
  const calendarDays = useMemo(() => buildCalendarDays(viewDate), [viewDate]);
  const weekDays = useMemo(() => getWeekDays(viewDate), [viewDate]);

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const meeting of meetings) {
      const date = new Date(meeting.dueDate);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const existing = map.get(key) || [];
      existing.push(meeting);
      map.set(key, existing.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()));
    }
    return map;
  }, [meetings]);

  const headerLabel = useMemo(() => {
    if (viewMode === 'day') {
      return viewDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    if (viewMode === 'week') {
      const start = weekDays[0];
      const end = weekDays[6];
      const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startStr} – ${endStr}`;
    }
    return viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [viewDate, viewMode, weekDays]);

  const goToPrev = () => {
    if (viewMode === 'month') {
      setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    } else if (viewMode === 'week') {
      setViewDate((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
    } else {
      setViewDate((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 1); return d; });
    }
  };

  const goToNext = () => {
    if (viewMode === 'month') {
      setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    } else if (viewMode === 'week') {
      setViewDate((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
    } else {
      setViewDate((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 1); return d; });
    }
  };

  const goToToday = () => setViewDate(new Date());

  const openNewEventModal = (preFillDate?: Date) => {
    setEditingMeeting(null);
    if (preFillDate) {
      const iso = preFillDate.toISOString().slice(0, 16);
      setForm({ ...emptyMeetingForm(), dueDate: iso });
    } else {
      setForm(emptyMeetingForm());
    }
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) { setFormError('You must be logged in to schedule meetings.'); return; }
    if (!form.title.trim()) { setFormError('Event title is required.'); return; }
    if (!form.dueDate) { setFormError('Date and time are required.'); return; }

    setSaving(true);
    setFormError(null);

    try {
      const selectedLead = leads.find((l) => l.id === form.leadId);
      const assignedTo = currentUser.id;
      const dueDate = new Date(form.dueDate).toISOString();

      if (editingMeeting) {
        await updateTask(editingMeeting, {
          title: form.title.trim(),
          description: form.description.trim(),
          dueDate,
          leadId: form.leadId || undefined,
          leadName: selectedLead?.fullName,
          assignedTo,
        });
      } else {
        await addMeeting({
          title: form.title.trim(),
          description: form.description.trim(),
          priority: 'high',
          dueDate,
          leadId: form.leadId || undefined,
          leadName: selectedLead?.fullName,
          assignedTo,
          createdBy: currentUser.id,
          tenantId: currentUser.tenantId,
        });
      }
      setIsModalOpen(false);
      setEditingMeeting(null);
      setForm(emptyMeetingForm());
    } catch {
      setFormError(editingMeeting ? 'Failed to update event.' : 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  const today = new Date();

  const renderTimeGrid = (days: Date[], singleDay = false) => (
    <div className="flex flex-col flex-1 overflow-auto">
      <div className="grid border-b border-border/60" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}>
        <div className="p-2" />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div key={i} className={`p-2 text-center border-l border-border/40 ${isToday ? 'bg-primary/5' : ''}`}>
              <span className="text-[10px] font-bold text-muted-foreground uppercase">{WEEKDAYS[day.getDay()]}</span>
              <span className={`block text-lg font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{day.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}>
          {HOURS.map((hour) => (
            <React.Fragment key={hour}>
              <div className="h-16 border-b border-border/30 flex items-start justify-end pr-2 pt-1">
                <span className="text-[10px] font-mono text-muted-foreground">{hour}:00</span>
              </div>
              {days.map((day, di) => {
                const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                const dayMeetings = (meetingsByDay.get(dayKey) || []).filter((m) => getHourFromDate(m.dueDate) === hour);
                return (
                  <div
                    key={di}
                    className="h-16 border-b border-l border-border/30 relative hover:bg-secondary/20 cursor-pointer transition-colors"
                    onClick={() => openNewEventModal(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour))}
                  >
                    {dayMeetings.map((meeting) => (
                      <button
                        key={meeting.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedMeeting(meeting); }}
                        className={`absolute inset-x-0.5 top-0.5 p-1 rounded ${getPriorityEventColor(meeting.priority)} text-white text-[10px] font-semibold truncate hover:opacity-90 transition-opacity cursor-pointer z-10`}
                        title={meeting.title}
                      >
                        {formatEventTime(meeting.dueDate)} · {meeting.title}
                      </button>
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full w-full overflow-hidden flex flex-col p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-4 flex-1 flex flex-col overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Calendar & Meetings</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Schedule consultations, demos, and travel briefings.
              {meetings.length > 0 && (
                <span className="ml-2 text-primary font-semibold">{meetings.length} scheduled</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-border/60 bg-card overflow-hidden">
              {([
                { mode: 'month' as const, icon: LayoutGrid, label: 'Month' },
                { mode: 'week' as const, icon: Rows3, label: 'Week' },
                { mode: 'day' as const, icon: Square, label: 'Day' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`h-9 px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary/80'
                  }`}
                  aria-label={`${label} view`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openNewEventModal()}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors shadow-md shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              <span>New Event</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-secondary/30 shrink-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={goToPrev} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-card/80 border border-transparent hover:border-border/60 transition-all" aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={goToNext} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-card/80 border border-transparent hover:border-border/60 transition-all" aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </button>
              <h3 className="text-sm font-bold text-foreground font-heading ml-1">{headerLabel}</h3>
            </div>
            <button
              type="button"
              onClick={goToToday}
              className="h-8 px-3 rounded-xl bg-card/80 border border-border/60 text-xs font-semibold text-foreground hover:border-primary/40 transition-colors"
            >
              Today
            </button>
          </div>

          {viewMode === 'month' && (
            <>
              <div className="grid grid-cols-7 border-b border-border/60">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="p-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider font-mono">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 flex-1 overflow-auto">
                {calendarDays.map((date, idx) => {
                  const isToday = isSameDay(date, today);
                  const isCurrentMonth = date.getMonth() === viewDate.getMonth();
                  const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                  const dayMeetings = meetingsByDay.get(dayKey) || [];
                  return (
                    <div
                      key={`${dayKey}-${idx}`}
                      onClick={() => openNewEventModal(date)}
                      className={`min-h-[110px] p-2 border-b border-r border-border/40 transition-colors hover:bg-secondary/30 cursor-pointer ${
                        !isCurrentMonth ? 'bg-secondary/20' : ''
                      }`}
                    >
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                        isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      } ${!isCurrentMonth ? 'text-muted-foreground' : ''}`}>
                        {date.getDate()}
                      </span>
                      <div className="mt-1.5 space-y-1">
                        {dayMeetings.slice(0, 3).map((meeting) => (
                          <button
                            key={meeting.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedMeeting(meeting); }}
                            className={`w-full text-left p-1.5 rounded-lg ${getPriorityEventColor(meeting.priority)} text-white text-[10px] font-semibold truncate hover:opacity-90 transition-opacity cursor-pointer`}
                            title={meeting.title}
                          >
                            {formatEventTime(meeting.dueDate)} · {meeting.title}
                          </button>
                        ))}
                        {dayMeetings.length > 3 && (
                          <span className="block text-[10px] text-muted-foreground font-medium px-1">
                            +{dayMeetings.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {viewMode === 'week' && renderTimeGrid(weekDays)}
          {viewMode === 'day' && renderTimeGrid([viewDate], true)}
        </div>

        {meetings.length === 0 && (
          <div className="shrink-0 rounded-2xl border border-border/60 bg-card/80 shadow-sm overflow-hidden">
            <EmptyState
              title="No Meetings"
              description="No meetings scheduled yet."
              icon="inbox"
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedMeeting && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-popover/90 backdrop-blur-xl border border-border/60 w-full max-w-md rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="flex h-14 items-center justify-between px-5 border-b border-border/60 bg-secondary/50">
                <span className="font-heading font-bold text-foreground text-xs uppercase tracking-wider select-none">
                  Meeting Details
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMeeting(null)}
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-4 text-sm">
                <div>
                  <h3 className="text-lg font-bold text-foreground font-heading">{selectedMeeting.title}</h3>
                  <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${getPriorityEventColor(selectedMeeting.priority)}`}>
                    {selectedMeeting.priority} priority
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4 shrink-0" />
                    <span>{formatDate(selectedMeeting.dueDate)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>{formatEventTime(selectedMeeting.dueDate)}</span>
                  </div>
                  {selectedMeeting.leadName && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4 shrink-0" />
                      <span>{selectedMeeting.leadName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4 shrink-0" />
                    <span>{selectedMeeting.assignedName}</span>
                  </div>
                </div>

                {selectedMeeting.description && (
                  <div className="p-3 rounded-xl bg-secondary/40 border border-border/60">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{selectedMeeting.description}</p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm(`Delete meeting "${selectedMeeting.title}"?`)) {
                        await deleteTask(selectedMeeting.id);
                        setSelectedMeeting(null);
                      }
                    }}
                    className="h-10 px-4 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 transition-colors border border-red-200"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMeeting(selectedMeeting.id);
                      setForm({
                        title: selectedMeeting.title,
                        description: selectedMeeting.description || '',
                        dueDate: selectedMeeting.dueDate.split('T')[0],
                        leadId: selectedMeeting.leadId || '',
                      });
                      setSelectedMeeting(null);
                      setIsModalOpen(true);
                    }}
                    className="h-10 px-4 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors shadow-md shadow-primary/20"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMeeting(null)}
                    className="h-10 px-5 rounded-xl bg-secondary text-foreground text-sm font-semibold hover:bg-secondary/80 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  {editingMeeting ? 'Edit Event' : 'New Event'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-thin text-sm">
                {formError && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs">{formError}</div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Title</label>
                  <input
                    required
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Discovery call with client"
                    className="h-10 rounded-xl bg-background border border-input px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Lead</label>
                  <select
                    value={form.leadId}
                    onChange={(e) => setForm((prev) => ({ ...prev, leadId: e.target.value }))}
                    className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  >
                    <option value="">No linked lead</option>
                    {leads.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.fullName}{lead.businessName ? ` — ${lead.businessName}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Date & Time</label>
                  <input
                    required
                    type="datetime-local"
                    value={form.dueDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    className="h-10 rounded-xl bg-background border border-input px-3 text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground font-mono text-[10px] uppercase font-bold">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Agenda, meeting link, or notes..."
                    rows={3}
                    className="rounded-xl bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all resize-none"
                  />
                </div>

                {currentUser && (
                  <p className="text-xs text-muted-foreground">
                    Assigned to <span className="font-semibold text-foreground">{currentUser.fullName}</span>
                  </p>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="h-10 px-4 rounded-xl border border-border/60 bg-background text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-md shadow-primary/20 disabled:opacity-60"
                  >
                    {saving ? 'Scheduling...' : 'Schedule Event'}
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
