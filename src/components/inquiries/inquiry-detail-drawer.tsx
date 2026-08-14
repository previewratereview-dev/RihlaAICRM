import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Mail,
  Phone,
  Edit2,
  CalendarDays,
  Send,
  AlertTriangle,
  User as UserIcon,
  MapPin,
  Clock,
  MessageSquare
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useCRMStore } from '@/hooks/use-crm-store';
import { EmailComposerModal } from '@/components/communication/email-composer-modal';
import type { InquiryDirectoryItem, LeadNote, LeadActivity, User, Lead, LeadStatus } from '@/types';

interface InquiryDetailDrawerProps {
  inquiry: InquiryDirectoryItem;
  // Passing legacy data down to maintain notes/activities without a rewrite
  notes: LeadNote[];
  activities: LeadActivity[];
  team: User[];
  onClose: () => void;
  // Trigger legacy edit modal with mapped data or wait for C2 for a new modal
  onEditLegacy: (legacyLead: Lead) => void;
  onUpdateLegacy: (legacyLeadId: string, updates: Partial<Lead>) => void;
  onAddNote: (legacyLeadId: string, authorId: string, authorName: string, content: string) => void;
  onDeleteNote: (legacyLeadId: string, noteId: string) => void;
  currentUser: import('@/types').User | null;
}

export function InquiryDetailDrawer({
  inquiry,
  notes,
  activities,
  team,
  onClose,
  onEditLegacy,
  onUpdateLegacy,
  onAddNote,
  onDeleteNote,
  currentUser,
}: InquiryDetailDrawerProps) {
  const [newNoteText, setNewNoteText] = useState('');
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const leads = useCRMStore((s) => s.leads);
  const startConversation = useCRMStore((s) => s.startConversation);
  
  // Try to find the legacy lead to support legacy write actions
  const legacyLead = inquiry.legacyLeadId 
    ? leads.find((l) => l.id === inquiry.legacyLeadId)
    : null;

  const handleStartConversation = async () => {
    try {
      await startConversation(inquiry.legacyLeadId, 'email', {
        travelerId: inquiry.travelerId,
        inquiryId: inquiry.inquiryId,
        travelerName: inquiry.travelerDisplayName,
        travelerEmail: inquiry.travelerEmail || undefined,
        phone: inquiry.travelerPhone || undefined,
      });
      onClose();
    } catch (err) {
      console.error('Failed to start conversation:', err);
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim() || !inquiry.legacyLeadId) return;
    onAddNote(inquiry.legacyLeadId, currentUser?.id || 'user-1', currentUser?.fullName || 'System', newNoteText.trim());
    setNewNoteText('');
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return 'Unassigned';
    const agent = team.find((u) => u.id === agentId);
    return agent ? agent.fullName : 'Unknown agent';
  };

  const formatStage = (stage: string) => {
    return stage
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background shadow-2xl border-l flex flex-col"
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b bg-card">
          <div className="flex-1">
            <h2 className="text-xl font-semibold">{inquiry.travelerDisplayName}</h2>
            {inquiry.identityReviewRequired && (
              <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-500/10 px-2 py-1 rounded-full">
                <AlertTriangle className="h-3.5 w-3.5" />
                Identity review pending
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {legacyLead && (
              <button
                onClick={() => onEditLegacy(legacyLead)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full transition-colors"
                title="Edit via legacy form"
              >
                <Edit2 className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-6">
            
            {/* Unified Communication Action Bar: Message, Email, Call */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStartConversation}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-border/80 bg-background hover:bg-muted text-foreground transition-all cursor-pointer shadow-sm"
                title="Open CRM Conversation"
              >
                <MessageSquare className="h-4 w-4 text-primary" />
                <span>Message</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEmailModalOpen(true)}
                disabled={!inquiry.travelerEmail}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border ${
                  inquiry.travelerEmail
                    ? 'border-border/80 bg-background hover:bg-muted text-foreground cursor-pointer'
                    : 'border-border/40 bg-muted/20 text-muted-foreground opacity-50 cursor-not-allowed'
                } transition-all shadow-sm`}
                title={inquiry.travelerEmail ? 'Compose email' : 'No email registered'}
              >
                <Mail className="h-4 w-4 text-blue-600" />
                <span>Email</span>
              </button>
              <a
                href={inquiry.travelerPhone ? `tel:${inquiry.travelerPhone}` : undefined}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border ${
                  inquiry.travelerPhone
                    ? 'border-border/80 bg-background hover:bg-muted text-foreground cursor-pointer'
                    : 'border-border/40 bg-muted/20 text-muted-foreground opacity-50 cursor-not-allowed'
                } transition-all shadow-sm`}
                onClick={(e) => !inquiry.travelerPhone && e.preventDefault()}
                title={inquiry.travelerPhone ? `Call ${inquiry.travelerPhone}` : 'No phone registered'}
              >
                <Phone className="h-4 w-4 text-emerald-600" />
                <span>Call</span>
              </a>
            </div>

            {/* Traveler Info */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <UserIcon className="h-4 w-4" /> Traveler Contact
              </h3>
              <div className="space-y-3 bg-card border rounded-lg p-4">
                <div>
                  <div className="text-xs text-muted-foreground">Email</div>
                  <div className="text-sm">{inquiry.travelerEmail || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Phone</div>
                  <div className="text-sm">{inquiry.travelerPhone || '—'}</div>
                </div>
              </div>
            </div>

            {/* Inquiry Info */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Inquiry Details
              </h3>
              <div className="space-y-3 bg-card border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Destination</div>
                    <div className="text-sm font-medium">{inquiry.destination || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Lead Source</div>
                    <div className="text-sm">{inquiry.leadSource || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Priority</div>
                    <div className="text-sm capitalize">{inquiry.priority || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Expected Value</div>
                    <div className="text-sm font-medium text-green-600 dark:text-green-400">
                      {inquiry.expectedValue === null ? '—' : inquiry.expectedValue === 0 ? '₹0' : formatCurrency(inquiry.expectedValue)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Status & Pipeline */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4" /> Pipeline & Assignment
              </h3>
              <div className="space-y-3 bg-card border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Stage</div>
                    {legacyLead ? (
                      <select
                        value={inquiry.pipelineStage}
                        onChange={(e) => onUpdateLegacy(legacyLead.id, { status: e.target.value as LeadStatus })}
                        className="w-full text-sm bg-background border rounded px-2 py-1"
                      >
                        <option value="inquiry_received">Inquiry Received</option>
                        <option value="initial_contact">Initial Contact</option>
                        <option value="options_shared">Options Shared</option>
                        <option value="consultation_booked">Consultation Booked</option>
                        <option value="itinerary_sent">Itinerary Sent</option>
                        <option value="follow_up">Follow Up</option>
                        <option value="customizing_package">Customizing Package</option>
                        <option value="booking_confirmed">Booking Confirmed</option>
                        <option value="booking_lost">Booking Lost</option>
                      </select>
                    ) : (
                      <div className="text-sm">{formatStage(inquiry.pipelineStage)}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Assigned Agent</div>
                    {legacyLead ? (
                      <select
                        value={inquiry.assignedAgentId || ''}
                        onChange={(e) => onUpdateLegacy(legacyLead.id, { assignedTo: e.target.value || undefined })}
                        className="w-full text-sm bg-background border rounded px-2 py-1"
                      >
                        <option value="">Unassigned</option>
                        {team.map(u => (
                          <option key={u.id} value={u.id}>{u.fullName}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-sm">{getAgentName(inquiry.assignedAgentId)}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Created At</div>
                    <div className="text-sm">{formatDate(inquiry.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Next Follow-up</div>
                    <div className="text-sm">{inquiry.nextFollowUpAt ? formatDate(inquiry.nextFollowUpAt) : '—'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes Section - Read Only if no legacyLeadId */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Edit2 className="h-4 w-4" /> Notes ({notes.length})
              </h3>
              
              {inquiry.legacyLeadId && (
                <form onSubmit={handleAddNote} className="mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="Add a note..."
                      className="flex-1 bg-background border rounded-md px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={!newNoteText.trim()}
                      className="px-3 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="bg-card border rounded-lg p-3 text-sm group">
                    <div className="flex items-start justify-between">
                      <div className="font-medium">{note.authorName}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(note.createdAt)}</span>
                        {inquiry.legacyLeadId && (
                          <button
                            onClick={() => inquiry.legacyLeadId && onDeleteNote(inquiry.legacyLeadId, note.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition-all"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Activities Section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Activity History ({activities.length})
              </h3>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                {activities.map((activity) => (
                  <div key={activity.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full border border-background bg-card text-muted-foreground shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                    <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2rem)] p-3 rounded-lg border bg-card shadow-sm text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-foreground capitalize">{activity.type.replace('_', ' ')}</span>
                        <time className="text-xs text-muted-foreground">{formatDate(activity.createdAt)}</time>
                      </div>
                      <p className="text-muted-foreground">{activity.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </motion.div>

      {/* Reusable In-Product Email Composer Modal */}
      {isEmailModalOpen && (
        <EmailComposerModal
          isOpen={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          travelerName={inquiry.travelerDisplayName}
          travelerEmail={inquiry.travelerEmail || ''}
          travelerId={inquiry.travelerId}
          inquiryId={inquiry.inquiryId}
          legacyLeadId={inquiry.legacyLeadId || undefined}
          defaultSubject={`Inquiry regarding ${inquiry.destination || 'your trip'}`}
        />
      )}
    </>
  );
}
