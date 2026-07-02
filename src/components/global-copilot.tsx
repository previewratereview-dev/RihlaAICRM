'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, X, Send, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function GlobalCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hi! I can help with leads, tasks, pipeline, and travel knowledge. What do you need?',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTab = useCRMStore((s) => s.activeTab);
  const leads = useCRMStore((s) => s.leads);
  const tasks = useCRMStore((s) => s.tasks);
  const conversations = useCRMStore((s) => s.conversations);
  const selectedLeadId = useCRMStore((s) => (s as { selectedLeadId?: string }).selectedLeadId);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const buildContext = () => {
    const selectedLead = selectedLeadId
      ? leads.find((l) => l.id === selectedLeadId)
      : leads[0];

    const pendingTasks = tasks.filter((t) => t.status === 'pending').slice(0, 5);
    const unreadConversations = conversations.filter((c) => c.unreadCount > 0).slice(0, 3);

    return {
      activeTab,
      selectedLead: selectedLead
        ? {
            id: selectedLead.id,
            name: selectedLead.fullName,
            status: selectedLead.status,
            destination: selectedLead.destination,
            aiScore: selectedLead.aiScore,
            dealValue: selectedLead.dealValue,
          }
        : null,
      pendingTasks: pendingTasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
      unreadConversations: unreadConversations.map((c) => ({
        id: c.id,
        leadName: c.leadName,
        lastMessage: c.lastMessage,
      })),
      leadCount: leads.length,
    };
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: CopilotMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context: buildContext() }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: data.content || 'No response.' },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: 'assistant', content: 'Something went wrong. Please try again.' },
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
          'fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg',
          open && 'bg-muted text-foreground hover:bg-muted'
        )}
        size="icon"
        aria-label="Toggle AI copilot"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>

      {open && (
        <div className="fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 flex w-[calc(100vw-2rem)] sm:w-[380px] flex-col rounded-2xl border border-border/60 bg-background shadow-2xl max-h-[70vh]">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">AI Copilot</span>
            <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider">{activeTab}</span>
          </div>

          <ScrollArea className="h-60 sm:h-80 px-4 py-3">
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm max-w-[90%]',
                    msg.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  )}
                >
                  {msg.content}
                </div>
              ))}
              {loading && (
                <div className="text-xs text-muted-foreground animate-pulse">Thinking...</div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="flex gap-2 border-t border-border/60 p-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about leads, tasks, or policies..."
              className="min-h-[40px] max-h-24 resize-none text-sm"
              rows={1}
            />
            <Button size="icon" onClick={send} disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
