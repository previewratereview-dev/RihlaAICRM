'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Search, User, ListTodo, MessageSquare } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function GlobalSearch() {
  const leads = useCRMStore((s) => s.leads);
  const tasks = useCRMStore((s) => s.tasks);
  const conversations = useCRMStore((s) => s.conversations);
  const setActiveTab = useCRMStore((s) => s.setActiveTab);
  const setGlobalSearchQuery = useCRMStore((s) => s.setGlobalSearchQuery);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { leads: [], tasks: [], conversations: [] };

    const leadResults = leads
      .filter(
        (l) =>
          l.fullName.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q) ||
          (l.destination || '').toLowerCase().includes(q)
      )
      .slice(0, 5);

    const taskResults = tasks
      .filter((t) => t.title.toLowerCase().includes(q) || (t.leadName || '').toLowerCase().includes(q))
      .slice(0, 4);

    const convResults = conversations
      .filter(
        (c) =>
          c.leadName.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q)
      )
      .slice(0, 4);

    return { leads: leadResults, tasks: taskResults, conversations: convResults };
  }, [query, leads, tasks, conversations]);

  const total =
    results.leads.length + results.tasks.length + results.conversations.length;

  const goLeads = () => {
    setGlobalSearchQuery(query);
    setActiveTab('leads');
    setOpen(false);
  };

  return (
    <div className="relative hidden lg:block w-72" ref={ref}>
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search… (Ctrl+K)"
        className="w-full h-9 rounded-lg bg-secondary/50 border border-input pl-9 pr-4 text-sm focus:outline-none focus:border-primary focus:bg-background"
      />
      {open && query && (
        <div className="absolute top-full mt-2 w-full max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl z-50 p-2">
          {total === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No results</p>
          ) : (
            <>
              {results.leads.map((l) => (
                <button
                  key={l.id}
                  onClick={goLeads}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 text-left text-sm"
                >
                  <User className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{l.fullName}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{formatCurrency(l.dealValue)}</span>
                </button>
              ))}
              {results.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveTab('tasks'); setOpen(false); }}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 text-left text-sm"
                >
                  <ListTodo className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
              {results.conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setActiveTab('conversations'); setOpen(false); }}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 text-left text-sm"
                >
                  <MessageSquare className="h-4 w-4 text-blue-600 shrink-0" />
                  <span className="truncate">{c.leadName}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
