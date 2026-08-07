import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Lead, LeadStatus } from '@/types';
import { PIPELINE_STAGES, PipelineInquiryViewModel } from '@/types/pipeline';
import { mapLeadToPipelineInquiry } from '@/lib/pipeline-utils';
import { normalizeLeadStatus, isClosedStatus } from '@/lib/pipeline-status';
import { cn, formatCurrency, getInitials } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Table as TableIcon,
  LayoutGrid,
  MapPin,
  Clock,
  MoreHorizontal,
  ChevronRight,
  User,
  AlertCircle
} from 'lucide-react';
import { PageContainer } from '@/components/ui/page-container';
import { Button } from '@/components/ui/button';
import { PipelineTable } from '@/components/leads/pipeline-table';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// We map stages from PIPELINE_STAGES
// And implement Grouping of Empty Stages

type EmptyStageGroupState = "collapsed" | "manually-expanded" | "temporarily-expanded-during-drag";

export function PipelineView() {
  const leads = useCRMStore((state) => state.leads);
  const team = useCRMStore((state) => state.team);
  const updateLead = useCRMStore((state) => state.updateLead);
  
  const [viewMode, setViewMode] = useState<'board'|'table'>('board');
  const [emptyGroupState, setEmptyGroupState] = useState<Record<string, EmptyStageGroupState>>({});
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // Read URL if needed (using search params in next/navigation normally, but window.location here for simplicity/sync)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      // eslint-disable-next-line
      if (urlParams.get('view') === 'table') setViewMode('table');
    }
  }, []);

  const handleSetViewMode = (mode: 'board'|'table') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('view', mode);
      window.history.replaceState({}, '', url);
    }
  };

  const inquiries = useMemo(() => {
    return leads.map(l => mapLeadToPipelineInquiry(l, team));
  }, [leads, team]);

  const inquiriesByStage = useMemo(() => {
    const grouped: Record<string, PipelineInquiryViewModel[]> = {};
    PIPELINE_STAGES.forEach((stage) => { grouped[stage.id] = []; });
    inquiries.forEach((iq) => {
      const stageId = normalizeLeadStatus(iq.stageId);
      if (grouped[stageId]) grouped[stageId].push(iq);
    });
    return grouped;
  }, [inquiries]);

  // Grouping logic for empty stages
  const stageColumns = useMemo(() => {
    type StageGroup = { stage: typeof PIPELINE_STAGES[0]; inquiries: PipelineInquiryViewModel[]; idx: number };
    type StageColumn = 
      | { isGroup: true; id: string; stages: StageGroup[] }
      | { isGroup: false; id: string; stage: typeof PIPELINE_STAGES[0]; inquiries: PipelineInquiryViewModel[]; idx: number };

    const columns: StageColumn[] = [];
    let currentEmptyGroup: StageGroup[] = [];

    PIPELINE_STAGES.forEach((stage, idx) => {
      const stageInquiries = inquiriesByStage[stage.id] || [];
      const isEmpty = stageInquiries.length === 0;

      if (isEmpty) {
        currentEmptyGroup.push({ stage, inquiries: stageInquiries, idx });
      } else {
        if (currentEmptyGroup.length > 0) {
          // Push empty group
          columns.push({ isGroup: true, id: `group-${currentEmptyGroup[0].stage.id}`, stages: currentEmptyGroup });
          currentEmptyGroup = [];
        }
        columns.push({ isGroup: false, id: stage.id, stage, inquiries: stageInquiries, idx });
      }
    });

    if (currentEmptyGroup.length > 0) {
      columns.push({ isGroup: true, id: `group-${currentEmptyGroup[0].stage.id}`, stages: currentEmptyGroup });
    }

    return columns;
  }, [inquiriesByStage]);

  const handleDragStart = (e: React.DragEvent, inquiryId: string) => {
    setDraggedItem(inquiryId);
    e.dataTransfer.setData('text/plain', inquiryId);
    e.dataTransfer.effectAllowed = 'move';
    
    // Temporarily expand all groups during drag
    const newGroupState = { ...emptyGroupState };
    stageColumns.forEach(col => {
      if (col.isGroup && newGroupState[col.id] !== 'manually-expanded') {
        newGroupState[col.id] = 'temporarily-expanded-during-drag';
      }
    });
    setEmptyGroupState(newGroupState);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    // Revert temporarily expanded groups
    const newGroupState = { ...emptyGroupState };
    Object.keys(newGroupState).forEach(key => {
      if (newGroupState[key] === 'temporarily-expanded-during-drag') {
        newGroupState[key] = 'collapsed';
      }
    });
    setEmptyGroupState(newGroupState);
  };

  const handleDrop = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const inquiryId = e.dataTransfer.getData('text/plain');
    if (inquiryId) {
      updateLead(inquiryId, { status: stageId as LeadStatus });
    }
    handleDragEnd();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const toggleGroup = (groupId: string) => {
    setEmptyGroupState(prev => ({
      ...prev,
      [groupId]: prev[groupId] === 'manually-expanded' ? 'collapsed' : 'manually-expanded'
    }));
  };

  // Summary strip calculations
  const totalOpenInquiries = inquiries.filter(iq => !isClosedStatus(iq.stageId)).length;
  const totalExpectedValue = inquiries
    .filter(iq => !isClosedStatus(iq.stageId) && iq.expectedValue !== null)
    .reduce((sum, iq) => sum + (iq.expectedValue || 0), 0);
  const totalOverdue = inquiries.filter(iq => iq.nextFollowUpAt && new Date(iq.nextFollowUpAt) < new Date()).length;

  return (
    <PageContainer variant="board" className="h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-[var(--section-gap)]">
        <div>
          <h1 className="text-[var(--text-page-title)] font-bold tracking-tight text-foreground">Booking Pipeline</h1>
          <p className="text-[var(--text-body)] text-muted-foreground mt-1">
            {viewMode === 'board' 
              ? 'Move leads between stages using drag and drop or keyboard controls.'
              : 'Review, filter and update pipeline opportunities.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-secondary rounded-[var(--radius-surface)] border border-border/50">
            <Button
              variant={viewMode === 'board' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn("h-8 px-3 rounded-md shadow-none", viewMode === 'board' && "bg-background shadow-sm")}
              onClick={() => handleSetViewMode('board')}
            >
              <LayoutGrid className="w-4 h-4 mr-2" />
              Board
            </Button>
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn("h-8 px-3 rounded-md shadow-none", viewMode === 'table' && "bg-background shadow-sm")}
              onClick={() => handleSetViewMode('table')}
            >
              <TableIcon className="w-4 h-4 mr-2" />
              Table
            </Button>
          </div>
        </div>
      </div>

      {viewMode === 'table' ? (
        <PipelineTable 
          inquiries={inquiries} 
          onMoveToStage={(id, stageId) => updateLead(id, { status: stageId as LeadStatus })} 
          team={team} 
        />
      ) : (
        <div className="flex-1 flex flex-col min-h-0 h-full bg-card rounded-[var(--radius-surface)] border border-border/60 shadow-sm">
          {/* Summary Strip */}
          <div className="px-4 py-2 border-b border-border/60 bg-secondary/30 flex items-center gap-4 text-sm whitespace-nowrap overflow-x-auto scrollbar-none">
            <div className="flex items-center text-foreground font-medium pr-4 border-r border-border/60">
              <TrendingUp className="w-4 h-4 mr-2 text-primary" />
              {totalOpenInquiries} open inquiries · {totalExpectedValue > 0 ? formatCurrency(totalExpectedValue) : 'Value not estimated'} · {totalOverdue} follow-ups due
            </div>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {PIPELINE_STAGES.map((stage, i) => {
                const count = inquiriesByStage[stage.id]?.length || 0;
                return (
                  <React.Fragment key={stage.id}>
                    <div className={cn("flex items-center", count > 0 && "text-foreground font-medium")}>
                      {stage.label} ({count})
                    </div>
                    {i < PIPELINE_STAGES.length - 1 && <ChevronRight className="w-3 h-3 opacity-50" />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Board Area */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 min-h-0">
            <div className="flex h-full gap-4 min-h-0">
              {stageColumns.map((col) => {
                if (col.isGroup) {
                  const state = emptyGroupState[col.id] || 'collapsed';
                  const isExpanded = state !== 'collapsed';

                  if (!isExpanded) {
                    return (
                      <div 
                        key={col.id} 
                        className="w-[56px] shrink-0 h-full flex flex-col items-center justify-center border border-dashed border-border/60 rounded-xl bg-secondary/20 hover:bg-secondary/40 cursor-pointer transition-colors"
                        onClick={() => toggleGroup(col.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          // Auto-expand on drag hover handled by handleDragStart, but could be handled here for specific drop interactions
                        }}
                      >
                        <div className="flex items-center gap-2 -rotate-90 text-muted-foreground whitespace-nowrap font-medium text-sm">
                          {col.stages.length} empty stages <ChevronRight className="w-4 h-4 rotate-90" />
                        </div>
                      </div>
                    );
                  }

                  // If expanded, render the columns inside
                  return col.stages.map((stageItem: { stage: typeof PIPELINE_STAGES[0]; inquiries: PipelineInquiryViewModel[]; idx: number }) => (
                    <PipelineColumn 
                      key={stageItem.stage.id} 
                      stage={stageItem.stage} 
                      inquiries={stageItem.inquiries} 
                      handleDragStart={handleDragStart}
                      handleDrop={handleDrop}
                      handleDragOver={handleDragOver}
                      draggedItem={draggedItem}
                      onMoveToStage={(id, stageId) => updateLead(id, { status: stageId as LeadStatus })}
                    />
                  ));
                }

                return (
                  <PipelineColumn 
                    key={col.stage.id} 
                    stage={col.stage} 
                    inquiries={col.inquiries} 
                    handleDragStart={handleDragStart}
                    handleDrop={handleDrop}
                    handleDragOver={handleDragOver}
                    draggedItem={draggedItem}
                    onMoveToStage={(id, stageId) => updateLead(id, { status: stageId as LeadStatus })}
                  />
                );
              })}
              
              {/* Right edge indicator */}
              <div className="w-8 shrink-0 flex items-center justify-center h-full opacity-50 pointer-events-none">
                <ChevronRight className="w-6 h-6 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

interface PipelineColumnProps {
  stage: typeof PIPELINE_STAGES[0];
  inquiries: PipelineInquiryViewModel[];
  handleDragStart: (e: React.DragEvent, inquiryId: string) => void;
  handleDrop: (e: React.DragEvent, stageId: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  draggedItem: string | null;
  onMoveToStage: (id: string, stageId: string) => void;
}

function PipelineColumn({ stage, inquiries, handleDragStart, handleDrop, handleDragOver, draggedItem, onMoveToStage }: PipelineColumnProps) {
  const stageValue = inquiries.reduce((sum: number, iq: PipelineInquiryViewModel) => sum + (iq.expectedValue || 0), 0);
  
  return (
    <div 
      className="w-[240px] shrink-0 flex flex-col h-full min-h-0 rounded-xl bg-secondary/20 border border-border/40"
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, stage.id)}
    >
      <div className="p-3 border-b border-border/40 flex items-center justify-between sticky top-0 bg-background/50 backdrop-blur-sm z-10 rounded-t-xl">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
            {stage.label}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">
            {inquiries.length} {inquiries.length === 1 ? 'inquiry' : 'inquiries'} 
            {stageValue > 0 && ` · ${formatCurrency(stageValue)}`}
          </p>
        </div>
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2 scrollbar-thin">
        {inquiries.map((iq: PipelineInquiryViewModel) => (
          <PipelineCard 
            key={iq.id} 
            inquiry={iq} 
            onDragStart={(e) => handleDragStart(e, iq.id)} 
            isDragging={draggedItem === iq.id}
            onMoveToStage={onMoveToStage}
          />
        ))}
      </div>
    </div>
  );
}

interface PipelineCardProps {
  inquiry: PipelineInquiryViewModel;
  onDragStart: (e: React.DragEvent) => void;
  isDragging: boolean;
  onMoveToStage: (id: string, stageId: string) => void;
}

const PipelineCard = React.memo(function PipelineCard({ inquiry, onDragStart, isDragging, onMoveToStage }: PipelineCardProps) {
  const isOverdue = inquiry.nextFollowUpAt && new Date(inquiry.nextFollowUpAt) < new Date();
  
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        "group relative bg-card border border-border/60 rounded-xl p-3 shadow-sm hover:shadow-md hover:border-border transition-all cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50 scale-95"
      )}
    >
      {/* Header: Name and Priority */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-[14px] text-foreground truncate flex-1">
          {inquiry.displayName}
        </h4>
        <div className={cn(
          "h-2 w-2 rounded-full shrink-0 mt-1.5",
          inquiry.priority === 'urgent' ? 'bg-red-500' :
          inquiry.priority === 'high' ? 'bg-orange-500' :
          inquiry.priority === 'medium' ? 'bg-blue-400' : 'bg-muted-foreground'
        )} title={`Priority: ${inquiry.priority}`} />
      </div>

      {/* Destination */}
      <div className="text-[12px] text-muted-foreground mt-0.5 truncate">
        {inquiry.destination ? inquiry.destination : 'Destination not set'}
      </div>

      {/* Bottom Row / Overdue Override */}
      <div className="mt-3 flex items-center justify-between text-[12px] pt-2 border-t border-border/40">
        {isOverdue ? (
          <div className="flex items-center gap-1.5 text-red-500 font-medium truncate">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Follow-up overdue</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground font-medium truncate">
            <span className="truncate">{inquiry.expectedValue !== null ? formatCurrency(inquiry.expectedValue) : 'Value not estimated'}</span>
            <span className="opacity-50">·</span>
            <span>{inquiry.timeInStageLabel}</span>
          </div>
        )}
        
        {/* Assignee / Action */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {inquiry.assignedAgent ? (
            <div className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium text-[10px]" title={inquiry.assignedAgent.name}>
              {getInitials(inquiry.assignedAgent.name)}
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center" title="Unassigned">
              <User className="w-3 h-3 text-muted-foreground" />
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none border-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>Open details</DropdownMenuItem>
              <DropdownMenuItem>Schedule follow-up</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Assign agent...</DropdownMenuItem>
              <DropdownMenuItem>Set priority...</DropdownMenuItem>
              <DropdownMenuSeparator />
              {PIPELINE_STAGES.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => onMoveToStage(inquiry.id, s.id)}>
                  Move to {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.inquiry === next.inquiry && prev.isDragging === next.isDragging;
});
