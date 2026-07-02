'use client';

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Lead, LeadStatus } from '@/types';
import { PIPELINE_STAGES } from '@/types/pipeline';
import { normalizeLeadStatus, isClosedStatus } from '@/lib/pipeline-status';
import { getPriorityColor, formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Sparkles,
  TrendingUp,
  Layers,
} from 'lucide-react';

export function PipelineView() {
  const leads = useCRMStore((state) => state.leads);
  const updateLead = useCRMStore((state) => state.updateLead);
  const [focusedCard, setFocusedCard] = useState<{ stageIdx: number; cardIdx: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const leadsByStage = useMemo(() => {
    const grouped: Record<string, Lead[]> = {};
    PIPELINE_STAGES.forEach((stage) => { grouped[stage.id] = []; });
    leads.forEach((lead) => {
      const stage = normalizeLeadStatus(lead.status);
      if (grouped[stage]) grouped[stage].push({ ...lead, status: stage });
    });
    return grouped;
  }, [leads]);

  const columnSummaries = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => {
      const stageLeads = leadsByStage[stage.id] || [];
      return { ...stage, count: stageLeads.length, totalValue: stageLeads.reduce((sum, l) => sum + l.dealValue, 0) };
    });
  }, [leadsByStage]);

  const stageArrays = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => ({
      stage,
      leads: leadsByStage[stage.id] || [],
    }));
  }, [leadsByStage]);

  const handleKeyNavigation = useCallback((e: React.KeyboardEvent) => {
    if (!focusedCard) return;
    const { stageIdx, cardIdx } = focusedCard;
    const currentStage = stageArrays[stageIdx];
    if (!currentStage) return;

    let newStageIdx = stageIdx;
    let newCardIdx = cardIdx;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (cardIdx < currentStage.leads.length - 1) newCardIdx = cardIdx + 1;
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (cardIdx > 0) newCardIdx = cardIdx - 1;
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (stageIdx < stageArrays.length - 1) {
          newStageIdx = stageIdx + 1;
          const nextStageLeads = stageArrays[newStageIdx].leads;
          newCardIdx = Math.min(cardIdx, nextStageLeads.length - 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (stageIdx > 0) {
          newStageIdx = stageIdx - 1;
          const prevStageLeads = stageArrays[newStageIdx].leads;
          newCardIdx = Math.min(cardIdx, prevStageLeads.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (stageArrays[stageIdx].leads[cardIdx]) {
          const lead = stageArrays[stageIdx].leads[cardIdx];
          const currIdx = PIPELINE_STAGES.findIndex((s) => s.id === lead.status);
          if (e.key === 'Enter' && currIdx < PIPELINE_STAGES.length - 1) {
            updateLead(lead.id, { status: PIPELINE_STAGES[currIdx + 1].id });
            const newStageLeads = stageArrays[stageIdx].leads;
            if (newCardIdx >= newStageLeads.length - 1) newCardIdx = Math.max(0, newStageLeads.length - 2);
          }
        }
        break;
      default:
        return;
    }

    if (newStageIdx !== stageIdx || newCardIdx !== cardIdx) {
      setFocusedCard({ stageIdx: newStageIdx, cardIdx: newCardIdx });
    }
  }, [focusedCard, stageArrays, updateLead]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    board.addEventListener('keydown', handleKeyNavigation as unknown as EventListener);
    return () => board.removeEventListener('keydown', handleKeyNavigation as unknown as EventListener);
  }, [handleKeyNavigation]);

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDrop = (e: React.DragEvent, stageId: LeadStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) updateLead(leadId, { status: stageId });
  };

  const totalPipelineValue = leads.reduce((sum, l) => sum + l.dealValue, 0);
  const activePipelineValue = leads.filter((l) => !isClosedStatus(l.status)).reduce((sum, l) => sum + l.dealValue, 0);

  return (
    <div className="flex flex-col h-full w-full p-6 lg:p-8 overflow-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0 select-none">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Booking Pipeline</h2>
          <p className="text-sm text-muted-foreground font-medium mt-1">
            Drag and drop or use keyboard arrows to navigate.{' '}
            <span className="text-muted-foreground/70">← → ↑ ↓ move · Enter advance · Tab focus columns</span>
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm text-muted-foreground bg-card/80 border border-border/60 rounded-2xl px-5 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="font-medium">Active bookings:</span>
            <span className="text-foreground font-bold font-mono">{formatCurrency(activePipelineValue)}</span>
          </div>
          <div className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Total pipeline:</span>
            <span className="text-foreground font-bold font-mono">{formatCurrency(totalPipelineValue)}</span>
          </div>
        </div>
      </div>

      <div
        ref={boardRef}
        tabIndex={0}
        className="flex-1 flex gap-4 overflow-x-auto pb-4 scrollbar-thin select-none outline-none"
        role="grid"
        aria-label="Pipeline board. Use arrow keys to navigate between cards."
      >
        {stageArrays.map((col, stageIdx) => (
          <div
            key={col.stage.id}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.stage.id)}
            className={cn(
              'w-72 shrink-0 flex flex-col rounded-2xl bg-secondary/30 border border-border/60 p-4',
              'hover:bg-secondary/50 hover:shadow-sm transition-all duration-200'
            )}
          >
            <div className="flex justify-between items-center mb-4 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.stage.color }} />
                <span className="font-bold text-foreground truncate max-w-[130px]">{col.stage.label}</span>
                <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-secondary text-muted-foreground font-bold shrink-0">{col.leads.length}</span>
              </div>
              <span className="font-mono text-muted-foreground font-bold shrink-0 text-xs">{formatCurrency(col.leads.reduce((s, l) => s + l.dealValue, 0))}</span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-thin min-h-[250px]">
              {col.leads.map((lead, cardIdx) => {
                const isFocused = focusedCard?.stageIdx === stageIdx && focusedCard?.cardIdx === cardIdx;
                return (
                  <motion.div
                    key={lead.id}
                    layoutId={`deal-${lead.id}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, lead.id)}
                    tabIndex={0}
                    role="gridcell"
                    aria-label={`${lead.businessName}, ${lead.fullName}, ${formatCurrency(lead.dealValue)}, ${lead.status}`}
                    onFocus={() => setFocusedCard({ stageIdx, cardIdx })}
                    onClick={() => setFocusedCard({ stageIdx, cardIdx })}
                    className={cn(
                      'p-4 rounded-2xl bg-card/80 border cursor-grab active:cursor-grabbing',
                      'hover:border-primary/40 hover:shadow-md hover:shadow-primary/5 transition-all duration-200 group',
                      isFocused
                        ? 'border-primary ring-2 ring-primary/20 shadow-md shadow-primary/10'
                        : 'border-border/60'
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-foreground text-sm group-hover:text-primary transition-colors truncate max-w-[170px]">
                        {lead.businessName}
                      </span>
                      <span style={{ color: getPriorityColor(lead.priority) }} className="text-[10px] font-mono capitalize tracking-wider font-bold">
                        {lead.priority}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium truncate mt-1">{lead.fullName}</p>
                    <div className="mt-3 pt-3 border-t border-border/40 flex justify-between items-center text-xs font-mono">
                      <span className="text-foreground font-bold text-sm">{formatCurrency(lead.dealValue)}</span>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-border/60 text-xs text-foreground">
                        <Sparkles className="h-3 w-3 text-amber-500 fill-amber-500" />
                        <span className="font-semibold">{lead.aiScore}%</span>
                      </div>
                    </div>
                    <div className="hidden group-hover:flex items-center justify-between border-t border-border/60 mt-3 pt-2 text-[10px] text-muted-foreground select-none">
                      <span>Quick move:</span>
                      <div className="flex gap-1.5">
                        {PIPELINE_STAGES.findIndex((s) => s.id === lead.status) > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); const ci = PIPELINE_STAGES.findIndex((s) => s.id === lead.status); updateLead(lead.id, { status: PIPELINE_STAGES[ci - 1].id }); }}
                            className="px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border/60 cursor-pointer"
                          >Prev</button>
                        )}
                        {PIPELINE_STAGES.findIndex((s) => s.id === lead.status) < PIPELINE_STAGES.length - 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); const ci = PIPELINE_STAGES.findIndex((s) => s.id === lead.status); updateLead(lead.id, { status: PIPELINE_STAGES[ci + 1].id }); }}
                            className="px-2 py-1 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground border border-border/60 cursor-pointer"
                          >Next</button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {col.leads.length === 0 && (
                <div className="h-full flex items-center justify-center border border-dashed border-border/60 rounded-2xl p-6 py-12 text-center text-xs font-mono text-muted-foreground">
                  Drop deals here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
