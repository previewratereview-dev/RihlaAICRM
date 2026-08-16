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
} from 'lucide-react';
import type { AttentionSignal, AttentionActionDescriptor } from '@/lib/attention/types';

interface AttentionDrawerSectionProps {
  signals: AttentionSignal[];
  onActionClick?: (action: AttentionActionDescriptor, signal: AttentionSignal) => void;
}

export function AttentionDrawerSection({
  signals,
  onActionClick,
}: AttentionDrawerSectionProps) {
  if (!signals || signals.length === 0) {
    return null;
  }

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
    <div
      className="p-4 border-b bg-amber-500/5 border-amber-500/20"
      aria-label="Attention Required"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-400">
            Needs Attention
          </h3>
        </div>
        <span className="text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full">
          {signals.length} {signals.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="space-y-2.5">
        {signals.map((signal) => {
          const Icon = getSignalIcon(signal.signalType);
          const missingText = formatMissingFields(signal.missingFields);

          return (
            <div
              key={signal.id}
              className="bg-card p-3 rounded-lg border border-border/80 shadow-sm"
            >
              <div className="flex items-start gap-2.5">
                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground">
                    {signal.title}
                  </div>
                  {signal.reasons && signal.reasons.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {signal.reasons.join(' · ')}
                    </div>
                  )}
                  {missingText && (
                    <div className="text-xs text-muted-foreground mt-0.5 font-medium">
                      Missing: <span className="text-foreground">{missingText}</span>
                    </div>
                  )}

                  {signal.suggestedActions && signal.suggestedActions.length > 0 && onActionClick && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {signal.suggestedActions.map((action, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onActionClick(action, signal)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          {action.label}
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
