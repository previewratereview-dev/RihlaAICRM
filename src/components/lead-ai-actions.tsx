'use client';

import React, { useState } from 'react';
import { Sparkles, Mail, Target, FileText, Loader2 } from 'lucide-react';
import type { Lead, LeadActivity } from '@/types';
import { buildLeadContextBlock } from '@/lib/ai/lead-context';
import { useCRMStore } from '@/hooks/use-crm-store';

interface LeadAiActionsProps {
  lead: Lead;
  activities?: LeadActivity[];
}

export function LeadAiActions({ lead, activities = [] }: LeadAiActionsProps) {
  const addTask = useCRMStore((s) => s.addTask);
  const addLeadNote = useCRMStore((s) => s.addLeadNote);
  const currentUser = useCRMStore((s) => s.currentUser);
  const [loading, setLoading] = useState<string | null>(null);
  const [output, setOutput] = useState<{ type: string; text: string } | null>(null);

  const runAction = async (action: string, label: string) => {
    setLoading(action);
    setOutput(null);
    try {
      const leadContext = buildLeadContextBlock(lead, activities);
      const res = await fetch('/api/ai/lead-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, leadContext }),
      });
      const data = await res.json();
      setOutput({ type: label, text: data.content || 'No response' });

      if (action === 'next_action' && data.content) {
        const title = data.content.split('\n')[0].replace(/^ACTION:\s*/i, '').slice(0, 120);
        if (title && currentUser) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          await addTask({
            title: title || 'AI suggested follow-up',
            description: data.content,
            type: 'follow_up',
            priority: lead.priority,
            dueDate: tomorrow.toISOString(),
            leadId: lead.id,
            leadName: lead.fullName,
            assignedTo: lead.assignedTo || currentUser.id,
            createdBy: currentUser.id,
            tenantId: currentUser.tenantId,
          });
        }
      }
    } catch {
      setOutput({ type: label, text: 'Failed to generate. Check AI configuration.' });
    } finally {
      setLoading(null);
    }
  };

  const saveAsNote = async () => {
    if (!output || !currentUser) return;
    await addLeadNote(lead.id, currentUser.id, currentUser.fullName, output.text);
    setOutput(null);
  };

  const buttons = [
    { id: 'draft_email', label: 'Draft Email', icon: Mail },
    { id: 'next_action', label: 'Next Action', icon: Target },
    { id: 'meeting_prep', label: 'Meeting Prep', icon: FileText },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => runAction(btn.id, btn.label)}
            disabled={loading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 disabled:opacity-50"
          >
            {loading === btn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <btn.icon className="h-3.5 w-3.5" />}
            {btn.label}
          </button>
        ))}
      </div>
      {output && (
        <div className="p-3 rounded-xl bg-secondary/50 border border-border/60 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase font-mono text-primary flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> {output.type}
            </span>
            <button onClick={saveAsNote} className="text-xs font-semibold text-primary hover:underline">
              Save as note
            </button>
          </div>
          <p className="text-foreground leading-relaxed whitespace-pre-wrap">{output.text}</p>
        </div>
      )}
    </div>
  );
}
