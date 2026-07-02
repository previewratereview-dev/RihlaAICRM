import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Sparkle,
  Sparkles,
  Users,
  Activity,
  FileText,
  Trash2,
  ExternalLink,
  Mail,
  Phone,
  Edit2,
  Video,
  CalendarDays,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { getScoreLabel } from '@/lib/ai/lead-scoring';
import { LeadAiActions } from '@/components/lead-ai-actions';
import { LEAD_STATUS_OPTIONS } from '@/lib/constants';
import type { Lead, LeadNote, LeadActivity, User, LeadStatus } from '@/types';

interface LeadDetailDrawerProps {
  lead: Lead;
  notes: LeadNote[];
  activities: LeadActivity[];
  team: User[];
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onDelete: (id: string) => void;
  onUpdateLead: (id: string, updates: Partial<Lead>) => void;
  onAddNote: (leadId: string, authorId: string, authorName: string, content: string) => void;
  onDeleteNote: (leadId: string, noteId: string) => void;
  currentUser: import('@/types').User | null;
}

export function LeadDetailDrawer({
  lead,
  notes,
  activities,
  team,
  onClose,
  onEdit,
  onDelete,
  onUpdateLead,
  onAddNote,
  onDeleteNote,
  currentUser,
}: LeadDetailDrawerProps) {
  const [newNoteText, setNewNoteText] = useState('');

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    onAddNote(lead.id, currentUser?.id || 'user-1', currentUser?.fullName || 'System', newNoteText.trim());
    setNewNoteText('');
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 260 }}
      className="w-[440px] md:w-[500px] h-screen bg-background border-l border-border/60 shadow-[0_0_50px_rgba(15,23,42,0.08)] flex flex-col z-30 overflow-hidden"
    >
      <div className="flex h-16 items-center justify-between px-5 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 select-none">
          <Sparkle className="h-4 w-4 text-primary" />
          <span className="font-heading font-bold text-foreground tracking-tight text-xs uppercase font-mono">Intelligence Profile</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(lead)}
            className="p-2 rounded-xl border border-border bg-background text-muted-foreground hover:text-primary hover:border-primary/40 transition-all cursor-pointer"
            title="Edit Lead Details"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(lead.id)}
            className="p-2 rounded-xl border border-border bg-background text-muted-foreground hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all cursor-pointer"
            title="Delete Lead"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin text-sm text-foreground">
        {/* Lead Info Card */}
        <div className="p-4 rounded-xl bg-secondary/50 border border-border/60">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold text-foreground leading-tight font-heading">{lead.fullName}</h3>
              <p className="text-sm text-muted-foreground mt-0.5 font-medium">{lead.businessName}</p>
              <span className="text-[10px] text-muted-foreground font-mono mt-1 block uppercase tracking-wider">{lead.industry} &bull; {lead.country}</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold text-emerald-600 font-mono leading-none">{formatCurrency(lead.dealValue)}</span>
              <span className="text-[10px] text-muted-foreground block font-mono mt-1 uppercase">Est. Value</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border/60 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{lead.email}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{lead.phone || 'Not recorded'}</span>
            </div>
            {lead.website && (
              <div className="flex items-center gap-2 text-muted-foreground col-span-2">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <a href={lead.website} target="_blank" rel="noreferrer" className="hover:underline text-primary truncate font-medium">{lead.website}</a>
              </div>
            )}
          </div>
        </div>

        {/* Stage & Owner */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider font-semibold">Lead Stage</span>
            <select
              value={lead.status}
              onChange={(e) => onUpdateLead(lead.id, { status: e.target.value as LeadStatus })}
              className="h-9 rounded-xl bg-background border border-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              {LEAD_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider font-semibold">Assigned Owner</span>
            <select
              value={lead.assignedTo}
              onChange={(e) => onUpdateLead(lead.id, { assignedTo: e.target.value })}
              className="h-9 rounded-xl bg-background border border-input px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              {team.map((member) => (
                <option key={member.id} value={member.id}>{member.fullName}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Consultations & Meetings */}
        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            <span className="font-heading font-bold text-foreground text-xs uppercase tracking-wider">Consultations & Meetings</span>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Demo Date</label>
              <input
                type="date"
                value={lead.demoDate || ''}
                onChange={(e) => onUpdateLead(lead.id, { demoDate: e.target.value })}
                className="h-9 rounded-xl bg-background border border-input px-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Demo Time</label>
              <input
                type="time"
                value={lead.demoTime || ''}
                onChange={(e) => onUpdateLead(lead.id, { demoTime: e.target.value })}
                className="h-9 rounded-xl bg-background border border-input px-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Google Meet Link</label>
            <div className="relative">
              <Video className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="url"
                placeholder="https://meet.google.com/abc-defg-hij"
                value={lead.googleMeetLink || ''}
                onChange={(e) => onUpdateLead(lead.id, { googleMeetLink: e.target.value })}
                className="h-9 rounded-xl bg-background border border-input pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Meeting Status</label>
              <select
                value={lead.meetingStatus || ''}
                onChange={(e) => onUpdateLead(lead.id, { meetingStatus: e.target.value as Lead['meetingStatus'] })}
                className="h-9 rounded-xl bg-background border border-input px-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="">No Scheduled Meeting</option>
                <option value="pending">Pending Discovery Call</option>
                <option value="completed">Demo Call Completed</option>
                <option value="cancelled">Demo Call Cancelled</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Follow-Up State</label>
              <input
                type="text"
                placeholder="e.g. Awaiting budget signoff"
                value={lead.followUpStatus || ''}
                onChange={(e) => onUpdateLead(lead.id, { followUpStatus: e.target.value })}
                className="h-9 rounded-xl bg-background border border-input px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Call / Demo Discussion Notes</label>
            <textarea
              placeholder="Enter discussion notes from call..."
              value={lead.meetingNotes || ''}
              onChange={(e) => onUpdateLead(lead.id, { meetingNotes: e.target.value })}
              rows={3}
              className="rounded-xl bg-background border border-input p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* AI Actions */}
        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider font-mono">AI Actions</span>
          </div>
          <LeadAiActions lead={lead} activities={activities} />
        </div>

        {/* AI Lead Diagnostics */}
        <div className="p-4 rounded-xl bg-card border border-border/60 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 h-10 w-12 bg-secondary/60 border-l border-b border-border/60 rounded-bl-xl flex items-center justify-center font-bold font-mono text-primary text-xs">{lead.aiScore}%</div>
          <div className="flex items-center gap-2 mb-3 select-none">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider font-mono">AI Lead Diagnostics</span>
            <span className="text-[10px] font-mono text-muted-foreground ml-1">({getScoreLabel(lead.aiScore)})</span>
          </div>
          <div className="space-y-3 text-sm">
            {lead.conversionProbability != null && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5 border border-primary/10">
                <span className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Conversion Probability</span>
                <span className="font-bold text-primary">{lead.conversionProbability}%</span>
              </div>
            )}
            {lead.aiScoreDetails && lead.aiScoreDetails.length > 0 && (
              <div>
                <span className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Score Breakdown</span>
                <div className="mt-2 space-y-1.5">
                  {lead.aiScoreDetails.map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-2 text-xs p-2 rounded-lg bg-secondary/40">
                      <div>
                        <span className="font-semibold text-foreground">{row.label}</span>
                        <p className="text-muted-foreground mt-0.5">{row.reason}</p>
                      </div>
                      <span className="font-mono font-bold text-primary shrink-0">+{row.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Pain Points</span>
              <p className="mt-1 text-foreground leading-relaxed">{lead.painPoints || 'None specified'}</p>
            </div>
            <div>
              <span className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Interested Service</span>
              <p className="mt-1 font-bold text-foreground">{lead.interestedService || 'Custom automation'}</p>
            </div>
            <div>
              <span className="text-muted-foreground font-mono text-[10px] uppercase font-semibold">Executive Lead Summary</span>
              <p className="mt-1 text-muted-foreground leading-relaxed italic bg-secondary/50 p-3 rounded-lg border border-border/60">{lead.aiSummary}</p>
            </div>
          </div>
        </div>

        {/* Assignment History */}
        {lead.assignmentHistory && lead.assignmentHistory.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-border/60 pb-1.5 select-none">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] font-bold text-foreground uppercase tracking-wider font-mono">Lead Ownership History</span>
            </div>
            <div className="space-y-2 font-mono text-xs">
              {lead.assignmentHistory.map((hist, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-secondary/50 border border-border/60 text-muted-foreground">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-foreground">Reassigned</span>
                    <span>{formatDate(hist.timestamp)} {new Date(hist.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    From <span className="font-semibold text-foreground">{hist.previousOwnerName}</span> to <span className="font-semibold text-foreground">{hist.newOwnerName}</span>
                  </p>
                  <span className="text-[10px] text-muted-foreground block mt-1">Changed by: {hist.changedByName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit Log Timeline */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-border/60 pb-1.5 select-none">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] font-bold text-foreground uppercase tracking-wider font-mono">Audit Log Timeline</span>
          </div>
          <div className="space-y-3.5">
            {activities.map((act) => (
              <div key={act.id} className="flex gap-3 text-sm leading-relaxed">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                <div>
                  <div className="flex gap-1 flex-wrap font-medium">
                    <span className="font-bold text-foreground">{act.title}</span>
                    <span className="text-muted-foreground">by {act.userName}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">{act.description}</p>
                  <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">{formatDate(act.createdAt)}</span>
                </div>
              </div>
            ))}
            {activities.length === 0 && (
              <div className="text-center py-6 text-muted-foreground font-mono text-xs">No activity recorded.</div>
            )}
          </div>
        </div>

        {/* Analyst Notes */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-border/60 pb-1.5 select-none">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] font-bold text-foreground uppercase tracking-wider font-mono">Analyst Notes</span>
          </div>

          <form onSubmit={handleAddNote} className="flex gap-2">
            <input
              type="text"
              placeholder="Append new system note..."
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              className="flex-1 h-10 rounded-xl bg-background border border-input px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <button
              type="submit"
              className="h-10 px-4 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary/90 transition-all select-none cursor-pointer"
            >
              Log
            </button>
          </form>

          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="p-4 rounded-xl bg-secondary/50 border border-border/60 relative group">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-foreground text-xs uppercase tracking-wider">{note.authorName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">{formatDate(note.createdAt)}</span>
                    <button
                      onClick={() => {
                        if (window.confirm('Delete this note?')) {
                          onDeleteNote(lead.id, note.id);
                        }
                      }}
                      className="text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mt-2 whitespace-pre-wrap">{note.content}</p>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="text-center py-6 text-muted-foreground font-mono text-xs">No analyst notes filed.</div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
