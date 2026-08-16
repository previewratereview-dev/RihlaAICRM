'use client';

/**
 * Phase AI-5C.3: AI Quote Proposal Review Drawer
 * 
 * Provides authorized staff with an interactive review workspace to inspect:
 * - Suggested quote line items with price authority classification (verified vs estimate vs missing)
 * - Per-item partial acceptance checkboxes (select/deselect individual suggestions)
 * - Grounding and Provenance (CRM facts vs Assumptions vs Missing info)
 * - Suggested terms and customer notes
 * - Confidence score and warnings
 * - Safe 1-click "Apply Selected to Draft" populating normal draft editor state
 */

import React, { useState } from 'react';
import {
  Sparkles,
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  BookOpen,
  DollarSign,
  ShieldCheck,
  Info,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type {
  AIQuoteLineItemProposal,
  AIQuoteLineItemSuggestion,
  AIProposalMetadata,
} from '@/lib/ai/proposal';

export interface QuoteProposalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: AIQuoteLineItemProposal | null;
  metadata?: AIProposalMetadata | null;
  currency: string;
  hasInternalPricing?: boolean;
  onApplySelected: (
    selectedItems: AIQuoteLineItemSuggestion[],
    terms?: string | null,
    notes?: string | null
  ) => void;
  onRegenerate?: (customInstruction?: string) => void;
  isApplying?: boolean;
  isStale?: boolean;
}

export function QuoteProposalDrawer({
  isOpen,
  onClose,
  proposal,
  metadata,
  currency,
  onApplySelected,
  onRegenerate,
  isApplying = false,
  isStale = false,
}: QuoteProposalDrawerProps) {
  const [activeTab, setActiveTab] = useState<'suggestions' | 'grounding' | 'warnings' | 'pricing'>('suggestions');
  const [deselectedIndices, setDeselectedIndices] = useState<Set<number>>(new Set());
  const [includeTerms, setIncludeTerms] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showRegenerateInput, setShowRegenerateInput] = useState(false);

  if (!isOpen || !proposal) {
    return null;
  }

  const items = proposal.suggestedItems || [];
  const selectedItems = items.filter((_, idx) => !deselectedIndices.has(idx));
  const missingCount = items.filter((i) => i.pricingSource === 'missing' || !i.suggestedUnitPrice).length;
  const estimateCount = items.filter((i) => i.pricingSource === 'estimate' || i.pricingSource === 'historical').length;
  const catalogCount = items.filter((i) => i.pricingSource === 'authoritative_catalog' && i.authoritativeUnitPrice).length;

  const toggleItemSelection = (idx: number) => {
    const next = new Set(deselectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setDeselectedIndices(next);
  };

  const selectAll = () => {
    setDeselectedIndices(new Set());
  };

  const deselectAll = () => {
    setDeselectedIndices(new Set(items.map((_, idx) => idx)));
  };

  const handleApply = () => {
    if (selectedItems.length === 0) return;
    onApplySelected(
      selectedItems,
      includeTerms ? proposal.suggestedTermsAndConditions : null,
      includeNotes ? proposal.suggestedCustomerNotes : null
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background/80 backdrop-blur-sm transition-all">
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-card border-l shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">AI Quote Suggestions</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    Proposal Mode
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Grounded commercial line items • Non-authoritative until confirmed
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Stale Version Alert */}
          {isStale && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Warning:</strong> A newer quote version exists. Applying this proposal will stage into a new revision.
              </span>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex border-b bg-muted/10 px-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('suggestions')}
              className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'suggestions'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <DollarSign className="h-3.5 w-3.5" />
              <span>Suggested Items ({items.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('grounding')}
              className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'grounding'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Grounding & Assumptions</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pricing')}
              className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'pricing'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Price Authority</span>
            </button>
            {(proposal.warnings?.length || 0) > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('warnings')}
                className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                  activeTab === 'warnings'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span>Warnings ({proposal.warnings.length})</span>
              </button>
            )}
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* TAB 1: SUGGESTIONS */}
            {activeTab === 'suggestions' && (
              <div className="space-y-4">
                {/* Partial selection header */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pb-1 border-b">
                  <span>
                    Selected <strong>{selectedItems.length}</strong> of {items.length} items
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="text-primary hover:underline text-[11px] font-medium"
                    >
                      Select All
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={deselectAll}
                      className="text-muted-foreground hover:underline text-[11px]"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2.5">
                  {items.map((item, idx) => {
                    const isSelected = !deselectedIndices.has(idx);
                    const isMissing = item.pricingSource === 'missing' || !item.suggestedUnitPrice;
                    const isCatalog = item.pricingSource === 'authoritative_catalog' && item.authoritativeUnitPrice;

                    return (
                      <div
                        key={item.id || idx}
                        onClick={() => toggleItemSelection(idx)}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-card border-primary/40 shadow-sm'
                            : 'bg-muted/10 border-border/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleItemSelection(idx)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs font-semibold text-foreground truncate">
                                {item.title}
                              </h4>
                              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {item.category}
                              </span>
                            </div>

                            {item.description && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                {item.description}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 mt-2 pt-1 border-t border-dashed">
                              <span className="text-[11px] font-medium text-foreground">
                                Qty: {item.quantity}
                              </span>

                              {/* Price Authority Badge */}
                              {isCatalog ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>{currency} {item.authoritativeUnitPrice} (Verified Catalog)</span>
                                </span>
                              ) : isMissing ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800">
                                  <AlertCircle className="h-3 w-3" />
                                  <span>Price required (No rate found)</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                  <Info className="h-3 w-3" />
                                  <span>Suggested: {currency} {item.suggestedUnitPrice} (Estimate — confirmation required)</span>
                                </span>
                              )}

                              {item.notes && (
                                <span className="text-[10px] text-muted-foreground italic">
                                  Note: {item.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Terms and Notes Inclusion */}
                {(proposal.suggestedTermsAndConditions || proposal.suggestedCustomerNotes) && (
                  <div className="p-3 bg-muted/20 border rounded-lg space-y-2 mt-4">
                    <div className="text-xs font-semibold text-foreground">Additional Suggested Content</div>

                    {proposal.suggestedTermsAndConditions && (
                      <label className="flex items-start gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeTerms}
                          onChange={(e) => setIncludeTerms(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded text-primary"
                        />
                        <div>
                          <span className="font-medium text-foreground">Include Suggested Terms & Conditions</span>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {proposal.suggestedTermsAndConditions}
                          </p>
                        </div>
                      </label>
                    )}

                    {proposal.suggestedCustomerNotes && (
                      <label className="flex items-start gap-2 text-xs cursor-pointer pt-2 border-t">
                        <input
                          type="checkbox"
                          checked={includeNotes}
                          onChange={(e) => setIncludeNotes(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded text-primary"
                        />
                        <div>
                          <span className="font-medium text-foreground">Include Suggested Customer Notes</span>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            {proposal.suggestedCustomerNotes}
                          </p>
                        </div>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: GROUNDING */}
            {activeTab === 'grounding' && (
              <div className="space-y-4">
                {/* Confidence Meter */}
                <div className="p-3 bg-card border rounded-lg flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-foreground">Proposal Confidence Score</div>
                    <div className="text-[11px] text-muted-foreground">
                      Based on inquiry clarity and available data
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold text-primary">
                      {Math.round((proposal.grounding.confidenceScore || 0.9) * 100)}%
                    </span>
                  </div>
                </div>

                {/* Assumptions */}
                <div className="p-3 bg-card border rounded-lg space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <HelpCircle className="h-4 w-4 text-blue-500" />
                    <span>AI Pricing Assumptions ({proposal.grounding.assumptions.length})</span>
                  </div>
                  {proposal.grounding.assumptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No assumptions recorded.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {proposal.grounding.assumptions.map((ass, i) => (
                        <li key={i}>{ass}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Missing Information */}
                <div className="p-3 bg-card border rounded-lg space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span>Missing Commercial Information ({proposal.grounding.missingInformation.length})</span>
                  </div>
                  {proposal.grounding.missingInformation.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No missing information identified.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {proposal.grounding.missingInformation.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Grounding Sources */}
                <div className="p-3 bg-card border rounded-lg space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <BookOpen className="h-4 w-4 text-primary" />
                    <span>Grounding Sources ({proposal.grounding.sources.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {proposal.grounding.sources.map((src, i) => (
                      <div key={i} className="p-2 bg-muted/20 rounded border text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{src.title || src.field || src.type}</span>
                          <span className="text-[10px] uppercase font-mono text-muted-foreground">{src.type}</span>
                        </div>
                        {src.snippet && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                            &quot;{src.snippet}&quot;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: PRICE AUTHORITY */}
            {activeTab === 'pricing' && (
              <div className="space-y-4">
                <div className="p-4 bg-muted/20 border rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span>Price Authority Guardrails</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Under the CRM price-authority model, AI suggestions are <strong>never authoritative</strong>. 
                    Applying suggestions stages line items with initial zero values in the draft editor, displaying the suggested estimate 
                    for your verification. Staff must explicitly enter or confirm each price before saving or issuing the quote.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 bg-card border rounded-lg text-center">
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{catalogCount}</div>
                    <div className="text-[11px] text-muted-foreground">Verified Catalog</div>
                  </div>
                  <div className="p-3 bg-card border rounded-lg text-center">
                    <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{estimateCount}</div>
                    <div className="text-[11px] text-muted-foreground">Estimates</div>
                  </div>
                  <div className="p-3 bg-card border rounded-lg text-center">
                    <div className="text-lg font-bold text-red-600 dark:text-red-400">{missingCount}</div>
                    <div className="text-[11px] text-muted-foreground">Price Required</div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: WARNINGS */}
            {activeTab === 'warnings' && (
              <div className="space-y-2">
                {proposal.warnings.map((w, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                      w.severity === 'critical'
                        ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">{w.code}</div>
                      <div>{w.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="p-4 border-t bg-muted/10 space-y-3">
            {showRegenerateInput && onRegenerate && (
              <div className="p-3 bg-card border rounded-lg space-y-2">
                <label className="text-xs font-semibold text-foreground">
                  Custom Pricing Instructions
                </label>
                <textarea
                  rows={2}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g., Include 5-star airport transfers, focus on boutique accommodation..."
                  className="w-full text-xs p-2 bg-background border rounded-md"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRegenerateInput(false)}
                    className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRegenerate(customPrompt);
                      setShowRegenerateInput(false);
                    }}
                    className="px-3 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground"
                  >
                    Regenerate Proposal
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {onRegenerate && !showRegenerateInput && (
                  <button
                    type="button"
                    onClick={() => setShowRegenerateInput(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-muted transition-colors cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Refine with AI</span>
                  </button>
                )}
                {metadata?.latencyMs && (
                  <span className="text-[10px] text-muted-foreground">
                    Generated in {(metadata.latencyMs / 1000).toFixed(1)}s ({metadata.model})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedItems.length === 0 || isApplying}
                  onClick={handleApply}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
                >
                  <Check className="h-4 w-4" />
                  <span>
                    {isApplying
                      ? 'Applying...'
                      : `Apply ${selectedItems.length} Line ${selectedItems.length === 1 ? 'Item' : 'Items'} to Draft`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
