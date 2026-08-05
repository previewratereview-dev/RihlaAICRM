'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIState, useActions } from '@ai-sdk/rsc';
import { AI } from '@/lib/ai/rihla-copilot/actions';

function CopilotInner() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [uiState, setUIState] = useUIState<typeof AI>();
  const { submitUserMessage } = useActions() as { submitUserMessage: (content: string, clientContext?: { isLoggedIn: boolean, firstName?: string, tenantId?: string }) => Promise<{ id: string, display: React.ReactNode }> };
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const activeTab = useCRMStore((s) => s.activeTab);
  const currentUser = useCRMStore((s) => s.currentUser);
  const hasOverriddenRef = useRef(false);

  // Override the global initial registration message with an in-app greeting
  useEffect(() => {
    if (uiState.length === 1 && !hasOverriddenRef.current) {
      hasOverriddenRef.current = true;
      setUIState([{
        id: uiState[0].id,
        display: (
          <div className="bg-muted text-foreground rounded-xl px-3 py-2 text-sm max-w-[90%]">
            <div className="text-sm leading-relaxed">Hi! I can help with leads, tasks, pipeline, and travel knowledge. What do you need?</div>
          </div>
        )
      }]);
    }
  }, [uiState, uiState.length, setUIState]);

  // Use a MutationObserver to scroll only the chat viewport, avoiding full page shifts
  useEffect(() => {
    const chatEl = scrollRef.current;
    if (!chatEl) return;

    const viewport = chatEl.closest('[data-radix-scroll-area-viewport]') as HTMLElement;
    if (!viewport) return;

    const observer = new MutationObserver(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth'
      });
    });

    observer.observe(chatEl, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => observer.disconnect();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Add user message to UI state immediately
    setUIState((currentUI) => [
      ...currentUI,
      {
        id: Date.now().toString(),
        display: (
          <div className="ml-auto bg-primary text-primary-foreground rounded-xl px-3 py-2 text-sm max-w-[90%]">
            {text}
          </div>
        ),
      },
    ]);
    
    setInput('');
    setLoading(true);

    try {
      const response = await submitUserMessage(text, {
        isLoggedIn: !!currentUser,
        firstName: currentUser?.fullName,
        tenantId: currentUser?.tenantId
      });
      setUIState((currentUI) => [
        ...currentUI,
        {
          id: response.id,
          display: (
            <div className="bg-muted text-foreground rounded-xl px-3 py-2 text-sm max-w-[90%]">
              {response.display}
            </div>
          ),
        },
      ]);
    } catch {
      setUIState((currentUI) => [
        ...currentUI,
        {
          id: Date.now().toString(),
          display: (
            <div className="bg-destructive/10 text-destructive rounded-xl px-3 py-2 text-sm max-w-[90%]">
              Something went wrong. Please try again.
            </div>
          ),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-border/10',
          open ? 'bg-muted text-foreground hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90'
        )}
        size="icon"
        aria-label="Toggle AI copilot"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>

      {open && (
        <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 flex w-[calc(100vw-2rem)] sm:w-[380px] flex-col rounded-2xl border border-border/60 bg-background/95 backdrop-blur-md shadow-2xl max-h-[75vh] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-foreground">Rihla-Copilot</span>
            <span className="ml-auto text-[9px] text-muted-foreground uppercase font-bold tracking-widest">{activeTab}</span>
          </div>

          <ScrollArea className="h-72 sm:h-96 px-4 py-4">
            <div ref={scrollRef} className="space-y-4">
              {uiState.length === 0 && (
                <div className="bg-muted text-foreground rounded-xl px-3 py-2 text-sm max-w-[90%]">
                  <div className="text-sm leading-relaxed">Hi! I can help with leads, tasks, pipeline, and travel knowledge. What do you need?</div>
                </div>
              )}
              {uiState.map((msg) => (
                <div key={msg.id} className="flex flex-col">
                  {msg.display}
                </div>
              ))}
              {loading && (
                <div className="flex gap-1.5 items-center bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm w-fit">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse"></div>
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: '300ms' }}></div>
                </div>
              )}
            </div>
          </ScrollArea>

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
              placeholder="Ask Rihla-Copilot..."
              className="min-h-[40px] max-h-24 resize-none text-sm bg-background border-input focus-visible:ring-primary/20"
              rows={1}
            />
            <Button size="icon" onClick={send} disabled={loading || !input.trim()} className="shrink-0 h-[40px] w-[40px] rounded-lg">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// Wrapper to provide the AI State to the client component without changing parent imports

export function GlobalCopilot() {
  return <CopilotInner />;
}
