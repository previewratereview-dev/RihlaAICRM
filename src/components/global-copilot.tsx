'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Send, Sparkles, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { submitCrmCopilotMessage } from '@/lib/ai/rihla-copilot/crm-actions';
import type { KnowledgeSource } from '@/lib/ai/rihla-copilot/tools';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contextSummary?: string;
  sources?: KnowledgeSource[];
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
      content: "Hi! I'm Rihla Copilot. I can answer questions about the record you're viewing, search inquiries, check traveler history, or look up agency policies with citations.",
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
    if (activeContext.type === 'inquiry') contextLabel = 'Inquiry Context';
    else if (activeContext.type === 'traveler') contextLabel = 'Traveler Context';
    else if (activeContext.type === 'booking') contextLabel = 'Booking Context';
    else if (activeContext.type === 'conversation') contextLabel = 'Conversation Context';
  }

  // Auto-scroll on new messages
  useEffect(() => {
    const chatEl = scrollRef.current;
    if (!chatEl) return;

    const viewport = chatEl.closest('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  const send = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const nextId = messageIdRef.current++;
    const userMsgId = `user-${nextId}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: text,
      },
    ]);

    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const response = await submitCrmCopilotMessage(text, {
        pathname,
        contextType: activeContext?.type || 'none',
        contextId: activeContext?.id || null,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: response.id || `resp-${nextId}`,
          role: 'assistant',
          content: response.content,
          contextSummary: response.contextSummary,
          sources: response.sources,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${nextId}`,
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Quick suggestion chips based on active context
  const getSuggestions = () => {
    if (activeContext?.id && activeContext.type === 'inquiry') {
      return [
        'Has this traveler booked with us before?',
        'What tasks are pending for this inquiry?',
        'What destination is this inquiry for?',
      ];
    }
    if (activeContext?.id && activeContext.type === 'traveler') {
      return [
        'Show this traveler booking history',
        'What other inquiries does this traveler have?',
        'What contact flags are on file?',
      ];
    }
    if (activeContext?.id && activeContext.type === 'booking') {
      return [
        'What is the booking & payment status?',
        'What are the travel dates?',
        'What is our cancellation policy?',
      ];
    }
    return [
      'Find inquiries for Dubai',
      'Which inquiries need follow-up?',
      'What is our cancellation policy?',
    ];
  };

  return (
    <>
      <Button
        onClick={() => setOpen((v) => !v)}
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
