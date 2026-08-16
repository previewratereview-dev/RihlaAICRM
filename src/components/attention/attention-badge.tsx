'use client';

import React from 'react';
import { Clock, MessageSquare, UserX, CalendarX, FileQuestion, AlertCircle } from 'lucide-react';
import type { AttentionSignal } from '@/lib/attention/types';

interface AttentionBadgeProps {
  signals: AttentionSignal[];
}

export function AttentionBadge({ signals }: AttentionBadgeProps) {
  if (!signals || signals.length === 0) {
    return null;
  }

  // First signal is already the highest priority according to deterministic AI-4B sorting
  const primarySignal = signals[0];
  const additionalCount = signals.length - 1;

  const getSignalConfig = (signal: AttentionSignal) => {
    switch (signal.signalType) {
      case 'FOLLOW_UP_OVERDUE':
        return {
          label: 'Follow-up overdue',
          icon: Clock,
          className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/50',
        };
      case 'UNANSWERED_INBOUND':
        return {
          label: 'Awaiting reply',
          icon: MessageSquare,
          className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/50',
        };
      case 'UNASSIGNED_INQUIRY':
        return {
          label: 'Unassigned',
          icon: UserX,
          className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800/50',
        };
      case 'NO_FOLLOW_UP_SCHEDULED':
        return {
          label: 'No follow-up',
          icon: CalendarX,
          className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/50',
        };
      case 'MISSING_QUALIFICATION': {
        const count = signal.missingFields?.length || 1;
        return {
          label: count > 1 ? `Missing ${count} details` : 'Missing details',
          icon: FileQuestion,
          className: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        };
      }
      default:
        return {
          label: 'Needs attention',
          icon: AlertCircle,
          className: 'bg-amber-50 text-amber-700 border-amber-200',
        };
    }
  };

  const config = getSignalConfig(primarySignal);
  const Icon = config.icon;
  const detailedSummary = signals
    .map((s, idx) => `${idx + 1}. ${s.title}${s.reasons.length ? ` (${s.reasons.join('; ')})` : ''}`)
    .join(' | ');

  const accessibleLabel = `Attention required: ${signals.length} item${signals.length > 1 ? 's' : ''}. Primary: ${primarySignal.title}. All: ${detailedSummary}`;

  return (
    <div
      tabIndex={0}
      role="status"
      className="inline-flex items-center gap-1 max-w-full flex-wrap cursor-help focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-1 rounded-full"
      title={detailedSummary}
      aria-label={accessibleLabel}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${config.className}`}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate max-w-[130px] sm:max-w-none">{config.label}</span>
      </span>

      {additionalCount > 0 && (
        <span
          className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border/60 shrink-0"
          title={`${additionalCount} more attention item${additionalCount > 1 ? 's' : ''}`}
          aria-hidden="true"
        >
          +{additionalCount}
        </span>
      )}
    </div>
  );
}
