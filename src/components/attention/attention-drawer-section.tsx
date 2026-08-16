'use client';

import React from 'react';
import {
  AlertCircle,
  Clock,
  MessageSquare,
  UserX,
  CalendarX,
  FileQuestion,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import type { AttentionSignal, AttentionActionDescriptor } from '@/lib/attention/types';

interface AttentionDrawerSectionProps {
  signals: AttentionSignal[];
  onActionClick?: (action: AttentionActionDescriptor, signal: AttentionSignal) => void;
}

export function AttentionDrawerSection({
  signals,
  onActionClick,
}: AttentionDrawerSectionProps) {
  const setCopilotOpen = useCRMStore((s) => s.setCopilotOpen);
  const setCopilotInitialPrompt = useCRMStore((s) => s.setCopilotInitialPrompt);

  if (!signals || signals.length === 0) {
    return null;
  }

  const handleAskCopilotAll = () => {
    setCopilotOpen(true);
    setCopilotInitialPrompt({
      prompt: 'Please explain the attention items on this inquiry and suggest the next operational steps.',
      requestedIntent: 'explain_attention',
    });
  };

  const handleAskCopilotSignal = (signal: AttentionSignal) => {
    setCopilotOpen(true);
    let prompt = `Please explain why this inquiry has attention signal "${signal.title}" and suggest how to resolve it.`;
    let intent: 'explain_attention' | 'draft_reply' | 'suggest_next_step' = 'explain_attention';

    if (signal.signalType === 'FOLLOW_UP_OVERDUE') {
      prompt = `Draft a polite follow-up message for this inquiry (follow-up is overdue) and recommend a new schedule date.`;
      intent = 'draft_reply';
    } else if (signal.signalType === 'UNANSWERED_INBOUND') {
      prompt = `Summarize the customer message on this inquiry and draft a helpful reply.`;
      intent = 'draft_reply';
    } else if (signal.signalType === 'MISSING_QUALIFICATION') {
      prompt = `Check the conversation for the missing trip details (${signal.missingFields?.join(', ') || 'trip details'}).`;
      intent = 'suggest_next_step';
    } else if (signal.signalType === 'NO_FOLLOW_UP_SCHEDULED') {
      prompt = `Suggest an appropriate follow-up timing for this active inquiry.`;
      intent = 'suggest_next_step';
    }

    setCopilotInitialPrompt({
      prompt,
      requestedIntent: intent,
      requestedSignalType: signal.signalType,
    });
  };

  const getSignalIcon = (type: string) => {
    switch (type) {
      case 'FOLLOW_UP_OVERDUE':
        return Clock;
      case 'UNANSWERED_INBOUND':
        return MessageSquare;
      case 'UNASSIGNED_INQUIRY':
        return UserX;
      case 'NO_FOLLOW_UP_SCHEDULED':
        return CalendarX;
      case 'MISSING_QUALIFICATION':
        return FileQuestion;
      default:
        return AlertCircle;
    }
  };

  const formatMissingFields = (fields?: string[]) => {
    if (!fields || fields.length === 0) return null;
    const names: Record<string, string> = {
      destination: 'Destination',
      departure_date: 'Departure date',
      number_of_travelers: 'Traveler count',
      budget: 'Budget',
    };
    return fields.map((f) => names[f] || f).join(', ');
  };

  return (
    <section
      className="p-4 border-b bg-amber-500/5 border-amber-500/20"
      aria-label="Attention Required"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-400">
            Needs Attention
          </h3>
          <span
            className="text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full shrink-0"
            aria-label={`${signals.length} attention item${signals.length === 1 ? '' : 's'}`}
          >
            {signals.length} {signals.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleAskCopilotAll}
          className="inline-flex items-center gap-1 text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors px-2 py-0.5 rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="Ask Copilot about all attention items"
        >
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Ask Copilot</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {signals.map((signal) => {
          const Icon = getSignalIcon(signal.signalType);
          const missingText = formatMissingFields(signal.missingFields);

          return (
            <div
              key={signal.id}
              className="bg-card p-3 rounded-lg border border-border/80 shadow-sm overflow-hidden"
            >
              <div className="flex items-start gap-2.5">
                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground break-words">
                    {signal.title}
                  </div>
                  {signal.reasons && signal.reasons.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5 break-words">
                      {signal.reasons.join(' · ')}
                    </div>
                  )}
                  {missingText && (
                    <div className="text-xs text-muted-foreground mt-0.5 font-medium break-words">
                      Missing: <span className="text-foreground">{missingText}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {signal.suggestedActions && signal.suggestedActions.length > 0 && onActionClick && (
                      signal.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onActionClick(action, signal)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded py-0.5 px-1"
                          aria-label={`${action.label} for ${signal.title}`}
                        >
                          <span>{action.label}</span>
                          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </button>
                      ))
                    )}

                    <button
                      type="button"
                      onClick={() => handleAskCopilotSignal(signal)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded py-0.5 px-1"
                      aria-label={`Ask Copilot about ${signal.title}`}
                    >
                      <Sparkles className="h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
                      <span>Copilot</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
