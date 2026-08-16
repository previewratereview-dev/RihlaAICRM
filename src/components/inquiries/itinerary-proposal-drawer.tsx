'use client';

/**
 * Phase AI-5C.2: AI Itinerary Proposal Review Drawer & Panel
 * 
 * Provides authorized staff with a rich, interactive review workspace to inspect:
 * - Day-by-day itinerary schedule
 * - Grounding and Provenance (CRM facts vs Knowledge vs Assumptions vs Missing info)
 * - Structural diffs for revisions
 * - Confidence score and warnings
 * - Safe 1-click "Apply to Draft" populating normal draft editor state
 */

import React, { useState } from 'react';
import {
  Sparkles,
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  BookOpen,
  Calendar,
  Users,
  MapPin,
  Clock,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
  Info,
  CheckCircle2,
  FileText,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  AIItineraryDraftProposal,
  AIItineraryRevisionProposal,
  AIProposalMetadata,
  ItineraryStructuralDiff,
} from '@/lib/ai/proposal';
import { formatDate } from '@/lib/utils';

export interface ItineraryProposalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isRevision?: boolean;
  proposal: AIItineraryDraftProposal | null;
  revisionProposal?: AIItineraryRevisionProposal | null;
  structuralDiff?: ItineraryStructuralDiff | null;
  metadata?: AIProposalMetadata | null;
  isStale?: boolean;
  onApplyToDraft: (proposal: AIItineraryDraftProposal) => void;
  onRegenerate?: (customInstruction?: string) => void;
  isApplying?: boolean;
}

export function ItineraryProposalDrawer({
  isOpen,
  onClose,
  isRevision = false,
  proposal,
  revisionProposal,
  structuralDiff,
  metadata,
  isStale = false,
  onApplyToDraft,
  onRegenerate,
  isApplying = false,
}: ItineraryProposalDrawerProps) {
  const [activeTab, setActiveTab] = useState<'itinerary' | 'grounding' | 'diff'>('itinerary');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showRegenerateInput, setShowRegenerateInput] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({ 1: true });

  if (!isOpen || (!proposal && !revisionProposal)) {
    return null;
  }

  const effectiveDraft = revisionProposal ? revisionProposal.proposedDraft : proposal;
  if (!effectiveDraft) return null;

  const grounding = effectiveDraft.grounding || {
    sources: [],
    assumptions: [],
    missingInformation: [],
    confidenceScore: 0.9,
  };

  const confidencePct = Math.round((grounding.confidenceScore ?? 0.9) * 100);

  const toggleDay = (dayNum: number) => {
    setExpandedDays((prev) => ({ ...prev, [dayNum]: !prev[dayNum] }));
  };

  const handleApply = () => {
    onApplyToDraft(effectiveDraft);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-card border-l h-full shadow-2xl flex flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 border-b bg-muted/20 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                <Sparkles className="h-3 w-3" />
                {isRevision ? 'AI Revision Proposal' : 'AI Draft Proposal'}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                {confidencePct}% Confidence
              </span>
              {metadata?.latencyMs && (
                <span className="text-[11px] text-muted-foreground">
                  ({(metadata.latencyMs / 1000).toFixed(1)}s via {metadata.model})
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {effectiveDraft.title || 'Untitled Proposal'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Review grounding, assumptions, and program details before applying to draft editor.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stale Version Alert */}
        {isStale && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                <strong>Itinerary updated:</strong> The underlying itinerary version was changed after this proposal was generated.
              </span>
            </div>
            {onRegenerate && (
              <button
                type="button"
                onClick={() => onRegenerate()}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
              >
                Regenerate
              </button>
            )}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b bg-card px-4 pt-2 gap-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('itinerary')}
            className={`pb-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'itinerary'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Itinerary Program ({effectiveDraft.days.length} Days)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('grounding')}
            className={`pb-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'grounding'
                ? 'border-primary text-primary font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Grounding & Assumptions ({grounding.assumptions.length + grounding.missingInformation.length})</span>
          </button>

          {isRevision && structuralDiff && (
            <button
              type="button"
              onClick={() => setActiveTab('diff')}
              className={`pb-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'diff'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>
                Changes ({structuralDiff.modifiedDaysCount + structuralDiff.addedDaysCount + structuralDiff.removedDaysCount})
              </span>
            </button>
          )}
        </div>

        {/* Drawer Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: ITINERARY PROGRAM */}
          {activeTab === 'itinerary' && (
            <div className="space-y-4">
              {/* Trip Overview Card */}
              <div className="p-3.5 border rounded-xl bg-muted/20 space-y-2 text-xs">
                {effectiveDraft.destinationSummary && (
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span>{effectiveDraft.destinationSummary}</span>
                  </p>
                )}
                <div className="flex flex-wrap gap-4 text-muted-foreground pt-1">
                  {effectiveDraft.startDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(effectiveDraft.startDate)}
                      {effectiveDraft.endDate ? ` – ${formatDate(effectiveDraft.endDate)}` : ''}
                    </span>
                  )}
                  {effectiveDraft.passengerCount != null && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {effectiveDraft.passengerCount} Travelers
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {effectiveDraft.durationDays || effectiveDraft.days.length} Days Total
                  </span>
                </div>
              </div>

              {/* Day-by-Day Accordion */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Day-by-Day Schedule
                </h4>
                {effectiveDraft.days.map((day) => {
                  const isExpanded = !!expandedDays[day.dayNumber];
                  return (
                    <div
                      key={day.dayNumber}
                      className="border rounded-lg bg-card overflow-hidden transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDay(day.dayNumber)}
                        className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-primary/10 text-primary">
                              Day {day.dayNumber}
                            </span>
                            <span className="text-xs font-semibold text-foreground">{day.title}</span>
                          </div>
                          {day.theme && (
                            <p className="text-[11px] text-muted-foreground italic pl-7">
                              Theme: {day.theme}
                            </p>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="p-3 border-t bg-muted/10 space-y-2 text-xs">
                          {day.description && (
                            <p className="text-muted-foreground text-xs leading-relaxed">
                              {day.description}
                            </p>
                          )}

                          {/* Activities in Day */}
                          {day.items && day.items.length > 0 ? (
                            <div className="space-y-2 pt-1">
                              {day.items.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded-md border bg-card/80 space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-foreground text-xs">
                                      {item.title}
                                    </span>
                                    {item.time && (
                                      <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5">
                                        <Clock className="h-2.5 w-2.5" /> {item.time}
                                      </span>
                                    )}
                                  </div>
                                  {item.description && (
                                    <p className="text-[11px] text-muted-foreground">
                                      {item.description}
                                    </p>
                                  )}
                                  {item.location && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                      <MapPin className="h-2.5 w-2.5 text-muted-foreground" />
                                      {item.location}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground italic">
                              No specific time-stamped activities. Open day for leisure.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Inclusions & Exclusions */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 border rounded-xl bg-card space-y-1.5 text-xs">
                  <h5 className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> Inclusions
                  </h5>
                  {effectiveDraft.inclusions && effectiveDraft.inclusions.length > 0 ? (
                    <ul className="space-y-1 text-muted-foreground text-[11px]">
                      {effectiveDraft.inclusions.map((inc, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-emerald-600 shrink-0">•</span>
                          <span>{inc}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground italic text-[11px]">None specified</p>
                  )}
                </div>

                <div className="p-3 border rounded-xl bg-card space-y-1.5 text-xs">
                  <h5 className="font-semibold text-red-800 dark:text-red-300 flex items-center gap-1">
                    <X className="h-3.5 w-3.5" /> Exclusions
                  </h5>
                  {effectiveDraft.exclusions && effectiveDraft.exclusions.length > 0 ? (
                    <ul className="space-y-1 text-muted-foreground text-[11px]">
                      {effectiveDraft.exclusions.map((exc, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-red-600 shrink-0">•</span>
                          <span>{exc}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground italic text-[11px]">None specified</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GROUNDING & ASSUMPTIONS */}
          {activeTab === 'grounding' && (
            <div className="space-y-4 text-xs">
              {/* Assumptions Section */}
              <div className="p-3.5 border rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 space-y-2">
                <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-semibold">
                  <HelpCircle className="h-4 w-4 shrink-0" />
                  <span>Assumed by AI ({grounding.assumptions.length})</span>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  These details were inferred by the model because they were not explicitly defined in CRM facts:
                </p>
                {grounding.assumptions.length > 0 ? (
                  <ul className="space-y-1 text-foreground pl-2 text-xs">
                    {grounding.assumptions.map((assump, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-amber-600 font-bold shrink-0">•</span>
                        <span>{assump}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground italic text-[11px]">Zero ungrounded assumptions.</p>
                )}
              </div>

              {/* Missing Information Section */}
              <div className="p-3.5 border rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 space-y-2">
                <div className="flex items-center gap-1.5 text-blue-800 dark:text-blue-300 font-semibold">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>Missing Facts / Still Unknown ({grounding.missingInformation.length})</span>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Information that was omitted or requires consultant confirmation before sending to customer:
                </p>
                {grounding.missingInformation.length > 0 ? (
                  <ul className="space-y-1 text-foreground pl-2 text-xs">
                    {grounding.missingInformation.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-blue-600 font-bold shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground italic text-[11px]">All required facts are verified.</p>
                )}
              </div>

              {/* Source Provenance List */}
              <div className="p-3.5 border rounded-xl bg-card space-y-2">
                <h5 className="font-semibold text-foreground flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 text-primary shrink-0" />
                  <span>Grounded Sources & Citations</span>
                </h5>
                {grounding.sources && grounding.sources.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    {grounding.sources.map((src, i) => (
                      <div
                        key={i}
                        className="p-2 rounded-lg border bg-muted/20 flex items-start gap-2 text-[11px]"
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase">
                          {src.type.replace('_', ' ')}
                        </span>
                        <div className="flex-1">
                          {src.title && <span className="font-semibold text-foreground">{src.title}</span>}
                          {src.field && (
                            <span className="text-muted-foreground font-mono"> [{src.field}]</span>
                          )}
                          {src.snippet && (
                            <p className="text-muted-foreground italic mt-0.5">&quot;{src.snippet}&quot;</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic text-[11px]">
                    Directly derived from inquiry details and standard itinerary structure.
                  </p>
                )}
              </div>

              {/* Warnings */}
              {effectiveDraft.warnings && effectiveDraft.warnings.length > 0 && (
                <div className="p-3.5 border rounded-xl bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900 space-y-2">
                  <h5 className="font-semibold text-red-800 dark:text-red-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Advisories & Warnings</span>
                  </h5>
                  <ul className="space-y-1 text-xs">
                    {effectiveDraft.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-red-700 dark:text-red-300">
                        <span className="font-bold shrink-0">•</span>
                        <span>{w.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STRUCTURAL DIFF (REVISIONS ONLY) */}
          {activeTab === 'diff' && structuralDiff && (
            <div className="space-y-4 text-xs">
              {/* Revision Request Summary */}
              {revisionProposal?.requestedChangeSummary && (
                <div className="p-3 border rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                    Requested Modifications
                  </span>
                  <p className="text-xs text-foreground font-medium">
                    &quot;{revisionProposal.requestedChangeSummary}&quot;
                  </p>
                </div>
              )}

              {/* Modifications List */}
              {revisionProposal?.modificationsSummary && revisionProposal.modificationsSummary.length > 0 && (
                <div className="p-3 border rounded-xl bg-card space-y-2">
                  <h5 className="font-semibold text-foreground">AI Change Summary</h5>
                  <ul className="space-y-1 text-muted-foreground text-xs">
                    {revisionProposal.modificationsSummary.map((mod, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <ArrowRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                        <span>{mod}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Deterministic Day-by-Day Diff Visualizer */}
              <div className="space-y-2.5">
                <h5 className="font-semibold text-foreground">Deterministic Schedule Comparison</h5>
                {structuralDiff.dayDiffs.map((dDiff) => (
                  <div
                    key={dDiff.dayNumber}
                    className={`p-3 border rounded-lg space-y-2 ${
                      dDiff.status === 'added'
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
                        : dDiff.status === 'removed'
                        ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                        : dDiff.status === 'modified'
                        ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                        : 'bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className="flex items-center gap-2">
                        <span>Day {dDiff.dayNumber}: {dDiff.newTitle || dDiff.oldTitle}</span>
                      </span>
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${
                          dDiff.status === 'added'
                            ? 'bg-emerald-100 text-emerald-800'
                            : dDiff.status === 'removed'
                            ? 'bg-red-100 text-red-800'
                            : dDiff.status === 'modified'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {dDiff.status}
                      </span>
                    </div>

                    {/* Item-level diffs */}
                    {dDiff.itemDiffs && dDiff.itemDiffs.length > 0 && (
                      <div className="space-y-1 pl-2 border-l-2 border-border text-[11px]">
                        {dDiff.itemDiffs.map((iDiff, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            {iDiff.changeType === 'added' && (
                              <span className="text-emerald-600 font-bold">+ Added:</span>
                            )}
                            {iDiff.changeType === 'removed' && (
                              <span className="text-red-600 font-bold">- Removed:</span>
                            )}
                            {iDiff.changeType === 'modified' && (
                              <span className="text-amber-600 font-bold">~ Modified:</span>
                            )}
                            {iDiff.changeType === 'unchanged' && (
                              <span className="text-muted-foreground">Unchanged:</span>
                            )}
                            <span className="text-foreground">{iDiff.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drawer Footer: Actions */}
        <div className="p-4 border-t bg-muted/20 space-y-3">
          {showRegenerateInput && onRegenerate && (
            <div className="space-y-2 animate-in slide-in-from-bottom duration-150">
              <label className="text-xs font-medium text-foreground">
                Custom Adjustment Instructions (Optional):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Include 1 full free leisure day in Florence"
                  className="flex-1 text-xs bg-background border rounded-md px-3 py-1.5"
                />
                <button
                  type="button"
                  onClick={() => {
                    onRegenerate(customPrompt);
                    setShowRegenerateInput(false);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors cursor-pointer"
                >
                  Regenerate
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-medium rounded-lg border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Discard
              </button>
              {onRegenerate && !showRegenerateInput && (
                <button
                  type="button"
                  onClick={() => setShowRegenerateInput(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border hover:bg-muted text-foreground transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Adjust & Regenerate</span>
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={isApplying || isStale}
              onClick={handleApply}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{isApplying ? 'Applying to Draft...' : 'Apply to Draft'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
