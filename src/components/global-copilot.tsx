'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  X,
  Send,
  Sparkles,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { submitCrmCopilotMessage, confirmCopilotAction } from '@/lib/ai/rihla-copilot/crm-actions';
import type { KnowledgeSource } from '@/lib/ai/rihla-copilot/tools';
import type { ActionProposalDTO, ActionExecutionResult } from '@/lib/ai/rihla-copilot/actions/index';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contextSummary?: string;
  sources?: KnowledgeSource[];
  actionProposal?: ActionProposalDTO;
}

export function GlobalCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedSourceMsgId, setExpandedSourceMsgId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'init-1',
      role: 'assistant',
      content: "Hi! I'm Rihla Copilot. I can answer questions about the record you're viewing, search inquiries, check traveler history, look up agency policies with citations, or prepare governed stage and assignment updates.",
    },
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messageIdRef = useRef(1);
  const pathname = usePathname() || '/app/dashboard';
  const activeTab = useCRMStore((s) => s.activeTab);
  const activeContext = useCRMStore((s) => s.activeContext);

  // Compute context label for copilot header
  let contextLabel = activeTab || 'Dashboard';
  if (activeContext?.id) {
    contextLabel = `${activeContext.type}`;
  }

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const send = async (overrideText?: string) => {
    const textToSend = (overrideText || input).trim();
    if (!textToSend || loading) return;

    setInput('');
    const userMsgId = `usr-${messageIdRef.current++}`;
    const newMessages: CopilotMessage[] = [
      ...messages,
      { id: userMsgId, role: 'user', content: textToSend },
    ];
    setMessages(newMessages);
    setLoading(true);

    try {
      // Pass client context hint from active Zustand selection & router
      const clientHint = {
        pathname,
        activeContextType: activeContext?.type,
        activeContextId: activeContext?.id,
      };

      const result = await submitCrmCopilotMessage(textToSend, clientHint);

      setMessages((prev) => [
        ...prev,
        {
          id: result.id || `asst-${messageIdRef.current++}`,
          role: 'assistant',
          content: result.content,
          contextSummary: result.contextSummary,
          sources: result.sources,
          actionProposal: result.actionProposal,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${messageIdRef.current++}`,
          role: 'assistant',
          content: 'Sorry, I encountered an issue connecting to the assistant. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const getSuggestions = () => {
    if (activeContext?.type === 'inquiry') {
      return [
        'Move this inquiry to itinerary sent',
        'Who is this assigned to?',
        'What tasks are pending?',
      ];
    }
    if (activeContext?.type === 'traveler') {
      return [
        'Has this traveler booked with us before?',
        'What inquiries does this traveler have?',
      ];
    }
    if (activeContext?.type === 'booking') {
      return [
        'What is the payment status for this booking?',
        'When is the departure date?',
      ];
    }
    return [
      'What are our cancellation policies?',
      'Show high priority inquiries in Dubai',
    ];
  };

  return (
    <>
      <Button
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 h-12 sm:h-14 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-primary/20 group transition-all duration-300 ease-in-out flex items-center overflow-hidden p-0',
          open
            ? 'w-12 sm:w-14 justify-center bg-muted text-foreground hover:bg-muted'
            : 'w-12 sm:w-14 hover:w-[155px] justify-start bg-primary text-primary-foreground hover:bg-primary/95 shadow-primary/20 hover:shadow-primary/30'
        )}
        aria-label="Toggle AI copilot"
      >
        {open ? (
          <X className="h-5 w-5 shrink-0 m-auto" />
        ) : (
          <div className="flex items-center w-full">
            <div className="w-12 sm:w-14 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="font-semibold text-sm tracking-tight whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none -ml-2">
              Rihla-Copilot
            </span>
          </div>
        )}
      </Button>

      {open && (
        <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 flex w-[calc(100vw-2rem)] sm:w-[420px] flex-col rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-2xl max-h-[78vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-foreground">Rihla-Copilot</span>
            <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 uppercase tracking-wider">
              {contextLabel}
            </span>
          </div>

          {/* Messages Scroll Area */}
          <ScrollArea className="h-72 sm:h-[400px] px-4 py-4">
            <div ref={scrollRef} className="space-y-3">
              {messages.map((msg) => {
                const isExpanded = expandedSourceMsgId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex flex-col max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm',
                      msg.role === 'user'
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'mr-auto bg-muted text-foreground'
                    )}
                  >
                    {msg.contextSummary && (
                      <span className="text-[10px] font-mono text-muted-foreground mb-1 uppercase tracking-wider">
                        📍 {msg.contextSummary}
                      </span>
                    )}

                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:list-disc [&>ul]:pl-4 [&>ul]:mb-2 [&>ol]:list-decimal [&>ol]:pl-4">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    )}

                    {/* Action Confirmation Card (Phase AI-3) */}
                    {msg.actionProposal && (
                      <ActionConfirmationCard proposal={msg.actionProposal} />
                    )}

                    {/* Structured Knowledge Citations Display */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-border/40 text-xs">
                        <button
                          type="button"
                          onClick={() => setExpandedSourceMsgId(isExpanded ? null : msg.id)}
                          className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-medium transition-colors"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          <span>
                            {msg.sources.length} Source{msg.sources.length > 1 ? 's' : ''} Cited
                          </span>
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>

                        {isExpanded && (
                          <div className="mt-2 space-y-1.5 pl-1">
                            {msg.sources.map((src, idx) => (
                              <div
                                key={src.sourceId || idx}
                                className="p-2 rounded-lg bg-background/80 border border-border/50 text-[11px]"
                              >
                                <div className="flex items-center justify-between font-semibold text-foreground">
                                  <span>[S{idx + 1}] {src.title}</span>
                                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                    {src.sourceType}
                                  </span>
                                </div>
                                <p className="text-muted-foreground mt-1 text-[10.5px] line-clamp-2">
                                  {src.excerpt}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {loading && (
                <div className="flex gap-1.5 items-center bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm w-fit">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Suggestion Chips */}
          <div className="px-3 py-2 border-t border-border/40 bg-muted/20 flex flex-wrap gap-1.5">
            {getSuggestions().map((suggestion, i) => (
              <button
                key={i}
                type="button"
                onClick={() => send(suggestion)}
                disabled={loading}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 transition-colors text-left disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* Input Area */}
          <div className="flex gap-2 border-t border-border/60 bg-muted/10 p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask Rihla-Copilot about CRM records, tasks, or agency policies..."
              className="min-h-[40px] max-h-24 resize-none text-sm bg-background border-input focus-visible:ring-primary/20"
              rows={1}
            />
            <Button
              size="icon"
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="shrink-0 h-[40px] w-[40px] rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Action Confirmation Card (Phase AI-3)
 * Renders structured proposed state, requires human confirmation,
 * prevents double-submit, and revalidates on server before execution.
 */
function ActionConfirmationCard({ proposal }: { proposal: ActionProposalDTO }) {
  const [status, setStatus] = useState<'proposed' | 'confirming' | 'success' | 'failed' | 'stale' | 'cancelled'>('proposed');
  const [resultMessage, setResultMessage] = useState<string>('');

  const handleConfirm = async () => {
    if (status !== 'proposed') return;
    setStatus('confirming');

    try {
      const res: ActionExecutionResult = await confirmCopilotAction(proposal);
      if (res.success) {
        setStatus('success');
        setResultMessage(res.message || 'Action executed successfully.');
      } else if (res.errorCode === 'STALE_STATE') {
        setStatus('stale');
        setResultMessage(res.message || 'This record changed after the action was prepared.');
      } else {
        setStatus('failed');
        setResultMessage(res.message || res.error || 'Action failed.');
      }
    } catch {
      setStatus('failed');
      setResultMessage('Network error executing confirmed action. Please try again.');
    }
  };

  const handleCancel = () => {
    if (status !== 'proposed') return;
    setStatus('cancelled');
    setResultMessage('Action proposal cancelled.');
  };

  const getDetails = () => {
    if (proposal.actionType === 'update_inquiry_stage') {
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] my-2 p-2 rounded-lg bg-background/80 border border-border/40">
          <div>
            <span className="text-muted-foreground block text-[10px]">Current Stage</span>
            <span className="font-medium text-foreground">{proposal.currentState.stageLabel || proposal.currentState.stage || 'Unknown'}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Proposed Stage</span>
            <span className="font-semibold text-primary">{proposal.proposedState.stageLabel || proposal.proposedState.stage}</span>
          </div>
        </div>
      );
    }

    if (proposal.actionType === 'assign_inquiry') {
      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] my-2 p-2 rounded-lg bg-background/80 border border-border/40">
          <div>
            <span className="text-muted-foreground block text-[10px]">Current Assignee</span>
            <span className="font-medium text-foreground">{proposal.currentState.assignedAgentName || 'Unassigned'}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Proposed Assignee</span>
            <span className="font-semibold text-primary">{proposal.proposedState.assignedAgentName || 'Assignee'}</span>
          </div>
        </div>
      );
    }

    if (proposal.actionType === 'set_inquiry_follow_up') {
      const cur = proposal.currentState.nextFollowUpAt ? new Date(proposal.currentState.nextFollowUpAt).toLocaleString() : 'Not scheduled';
      const prop = proposal.proposedState.nextFollowUpAt ? new Date(proposal.proposedState.nextFollowUpAt).toLocaleString() : 'Clear follow-up';

      return (
        <div className="grid grid-cols-2 gap-2 text-[11px] my-2 p-2 rounded-lg bg-background/80 border border-border/40">
          <div>
            <span className="text-muted-foreground block text-[10px]">Current Follow-Up</span>
            <span className="font-medium text-foreground">{cur}</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[10px]">Proposed Follow-Up</span>
            <span className="font-semibold text-primary">{prop}</span>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="mt-2.5 p-3 rounded-xl border border-primary/30 bg-primary/5 text-foreground">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        <span>{proposal.title}</span>
      </div>

      <p className="text-[11.5px] text-muted-foreground mt-1">{proposal.summary}</p>

      {getDetails()}

      {/* State Badges / Messages */}
      {status === 'success' && (
        <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{resultMessage}</span>
        </div>
      )}

      {status === 'stale' && (
        <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium border border-amber-500/20">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{resultMessage}</span>
        </div>
      )}

      {status === 'failed' && (
        <div className="mt-2 flex items-center gap-1.5 p-2 rounded-lg bg-destructive/10 text-destructive text-xs font-medium border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{resultMessage}</span>
        </div>
      )}

      {status === 'cancelled' && (
        <div className="mt-2 p-1.5 text-xs text-muted-foreground italic">
          {resultMessage}
        </div>
      )}

      {/* Buttons */}
      {status === 'proposed' && (
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="h-7 text-xs px-2.5 bg-background"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1"
          >
            <span>Confirm</span>
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      {status === 'confirming' && (
        <div className="mt-2.5 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Executing confirmed action...</span>
        </div>
      )}
    </div>
  );
}
