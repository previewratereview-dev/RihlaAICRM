'use client';

import React from 'react';
import {
  AlertCircle,
  Clock,
  MessageSquare,
  UserX,
  CalendarX,
  FileQuestion,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AttentionSignal, TenantAttentionSummary } from '@/lib/attention/types';

interface DashboardNeedsAttentionProps {
  summary: TenantAttentionSummary | null;
  signals: AttentionSignal[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNavigateInquiry?: (inquiryId: string) => void;
  onNavigateConversation?: (conversationId: string) => void;
}

export function DashboardNeedsAttention({
  summary,
  signals,
  isLoading,
  error,
  onRefresh,
  onNavigateInquiry,
  onNavigateConversation,
}: DashboardNeedsAttentionProps) {
  if (isLoading && !summary) {
    return (
      <section
        className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4"
        role="status"
        aria-label="Loading attention items"
        aria-busy="true"
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-18 rounded-xl" />
          ))}
        </div>
        <div className="space-y-2 pt-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="p-5 rounded-2xl border border-destructive/30 bg-destructive/5 shadow-sm"
        role="alert"
        aria-label="Attention loading error"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-foreground">
                Unable to load attention items
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 break-words">{error}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            className="h-8 gap-1.5 text-xs shrink-0 self-start focus:ring-1 focus:ring-primary"
            aria-label="Retry loading attention items"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const overdueCount = summary?.signalsByType.FOLLOW_UP_OVERDUE || 0;
  const unansweredCount = summary?.signalsByType.UNANSWERED_INBOUND || 0;
  const unassignedCount = summary?.signalsByType.UNASSIGNED_INQUIRY || 0;
  const missingCount = summary?.signalsByType.MISSING_QUALIFICATION || 0;
  const noFollowUpCount = summary?.signalsByType.NO_FOLLOW_UP_SCHEDULED || 0;
  const totalSignals = summary?.signalsCount || 0;

  // Bounded preview: top 5 signals
  const previewSignals = signals.slice(0, 5);

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

  return (
    <section
      className="p-5 rounded-2xl border border-border/60 bg-card shadow-sm space-y-4"
      aria-label="Needs Attention Overview"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-600 dark:text-orange-400 shrink-0">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-base text-foreground truncate">Needs Attention</h2>
            <p className="text-xs text-muted-foreground truncate">
              Deterministic priority items across inquiries and customer messages
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary shrink-0"
          title="Refresh attention items"
          aria-label="Refresh attention items"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* 5-Item Metric Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3 rounded-xl border border-border/60 bg-background/50 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground font-medium truncate">Overdue Follow-ups</span>
            <Clock className="h-3.5 w-3.5 text-red-500 shrink-0" aria-hidden="true" />
          </div>
          <div className="text-xl font-bold text-foreground mt-1" aria-label={`${overdueCount} overdue follow-ups`}>
            {overdueCount}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/60 bg-background/50 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground font-medium truncate">Unanswered Inbound</span>
            <MessageSquare className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          </div>
          <div className="text-xl font-bold text-foreground mt-1" aria-label={`${unansweredCount} unanswered customer messages`}>
            {unansweredCount}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/60 bg-background/50 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground font-medium truncate">Unassigned Inquiries</span>
            <UserX className="h-3.5 w-3.5 text-purple-500 shrink-0" aria-hidden="true" />
          </div>
          <div className="text-xl font-bold text-foreground mt-1" aria-label={`${unassignedCount} unassigned inquiries`}>
            {unassignedCount}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/60 bg-background/50 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground font-medium truncate">Missing Details</span>
            <FileQuestion className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          </div>
          <div className="text-xl font-bold text-foreground mt-1" aria-label={`${missingCount} inquiries with missing qualification details`}>
            {missingCount}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/60 bg-background/50 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-muted-foreground font-medium truncate">No Follow-up Set</span>
            <CalendarX className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-hidden="true" />
          </div>
          <div className="text-xl font-bold text-foreground mt-1" aria-label={`${noFollowUpCount} active inquiries without a scheduled follow-up`}>
            {noFollowUpCount}
          </div>
        </div>
      </div>

      {/* Prioritized Preview List or Quiet Empty State */}
      {totalSignals === 0 ? (
        <div
          className="py-6 px-4 rounded-xl border border-border/40 bg-muted/20 text-center flex flex-col items-center justify-center"
          role="status"
          aria-label="No attention items required"
        >
          <CheckCircle2 className="h-6 w-6 text-emerald-500 mb-1.5 shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            Nothing requires immediate attention.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Top Priority Items ({previewSignals.length} of {totalSignals})
          </div>
          <div className="divide-y rounded-xl border border-border/60 bg-background/50 overflow-hidden">
            {previewSignals.map((signal) => {
              const Icon = getSignalIcon(signal.signalType);
              const isConv = signal.entityType === 'conversation';

              return (
                <div
                  key={signal.id}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {signal.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {signal.reasons?.join(' · ') || 'Action needed'}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 self-end sm:self-center">
                    {isConv ? (
                      <button
                        type="button"
                        onClick={() => onNavigateConversation?.(signal.entityId)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline px-2 py-1 rounded hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary"
                        aria-label={`Open conversation for ${signal.title}`}
                      >
                        <span>Open Conversation</span>
                        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onNavigateInquiry?.(signal.entityId)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline px-2 py-1 rounded hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary"
                        aria-label={`View inquiry for ${signal.title}`}
                      >
                        <span>View Inquiry</span>
                        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
