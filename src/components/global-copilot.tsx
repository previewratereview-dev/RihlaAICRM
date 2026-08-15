'use client';

import React, { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Send, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { submitCrmCopilotMessage } from '@/lib/ai/rihla-copilot/crm-actions';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contextSummary?: string;
}

export function GlobalCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'init-1',
      role: 'assistant',
      content: "Hi! I'm Rihla Copilot. I can help answer questions about the record or CRM page you're currently viewing.",
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
      return ['What destination is this inquiry for?', 'What stage is this at?', 'What information do we have?'];
    }
    if (activeContext?.id && activeContext.type === 'traveler') {
      return ['Summarize this traveler profile', 'What contact info is on file?'];
    }
    if (activeContext?.id && activeContext.type === 'booking') {
      return ['What is the booking & payment status?', 'What are the travel dates?'];
    }
    return ['What should I pay attention to here?', 'What can you help me with?'];
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
        <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 flex w-[calc(100vw-2rem)] sm:w-[400px] flex-col rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-2xl max-h-[75vh] overflow-hidden">
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
          <ScrollArea className="h-72 sm:h-96 px-4 py-4">
            <div ref={scrollRef} className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex flex-col max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm',
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
                </div>
              ))}

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
              placeholder="Ask Rihla-Copilot about this record or view..."
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
