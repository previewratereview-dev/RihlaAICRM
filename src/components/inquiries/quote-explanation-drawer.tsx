'use client';

/**
 * Phase AI-5C.3: Quote Difference Explanation Drawer
 * 
 * Provides authorized staff with a side-by-side commercial comparison of two quote versions:
 * 1. Deterministic facts first: grand total, subtotal, line-item adds/removes/modifications, discounts, taxes.
 * 2. Separate customer-facing explanation: client-safe prose explaining key drivers and scope changes.
 * 3. Separate internal explanation: supplier costs and gross margins (strictly hidden for unauthorized roles).
 */

import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Lock,
  FileText,
  Layers,
  AlertCircle,
} from 'lucide-react';
import type {
  AIQuoteDifferenceExplanation,
  AIProposalMetadata,
} from '@/lib/ai/proposal';

export interface QuoteExplanationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  explanation: AIQuoteDifferenceExplanation | null;
  metadata?: AIProposalMetadata | null;
  hasInternalPricing: boolean;
  currency: string;
}

export function QuoteExplanationDrawer({
  isOpen,
  onClose,
  explanation,
  metadata,
  hasInternalPricing,
  currency,
}: QuoteExplanationDrawerProps) {
  const [activeTab, setActiveTab] = useState<'changes' | 'customer' | 'internal'>('changes');
  const [hasCopied, setHasCopied] = useState(false);

  if (!isOpen || !explanation) {
    return null;
  }

  const diff = explanation.deterministicDiff;
  const isPositiveDelta = !diff.grandTotalDifference.startsWith('-');
  const isZeroDelta = diff.grandTotalDifference === '0.00';

  const handleCopyCustomerCopy = () => {
    if (explanation.clientFacingExplanation) {
      navigator.clipboard.writeText(explanation.clientFacingExplanation);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2500);
    }
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
                  <h3 className="text-sm font-semibold text-foreground">
                    Quote Comparison: v{diff.v1VersionNumber} → v{diff.v2VersionNumber}
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {diff.quoteNumber}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Authoritative arithmetic differences and AI commercial explanation
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

          {/* Authoritative Metric Banner */}
          <div className="p-4 bg-muted/10 border-b grid grid-cols-3 gap-3 text-center">
            <div className="p-2.5 bg-card border rounded-lg">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Base (v{diff.v1VersionNumber})</div>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {currency} {diff.v1GrandTotal}
              </div>
            </div>
            <div className="p-2.5 bg-card border rounded-lg">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Target (v{diff.v2VersionNumber})</div>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {currency} {diff.v2GrandTotal}
              </div>
            </div>
            <div
              className={`p-2.5 rounded-lg border ${
                isZeroDelta
                  ? 'bg-card border-border text-foreground'
                  : isPositiveDelta
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
              }`}
            >
              <div className="text-[10px] uppercase font-medium flex items-center justify-center gap-1">
                {isZeroDelta ? null : isPositiveDelta ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                <span>Difference</span>
              </div>
              <div className="text-sm font-bold mt-0.5">
                {isPositiveDelta && !isZeroDelta ? '+' : ''}
                {currency} {diff.grandTotalDifference}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b bg-muted/10 px-4 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('changes')}
              className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'changes'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Deterministic Changes</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('customer')}
              className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'customer'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Customer Explanation</span>
            </button>
            {hasInternalPricing && (
              <button
                type="button"
                onClick={() => setActiveTab('internal')}
                className={`px-3 py-2.5 border-b-2 font-medium flex items-center gap-1.5 transition-colors ${
                  activeTab === 'internal'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Lock className="h-3.5 w-3.5 text-amber-500" />
                <span>Internal Analysis</span>
              </button>
            )}
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* TAB 1: DETERMINISTIC CHANGES */}
            {activeTab === 'changes' && (
              <div className="space-y-4">
                {/* Arithmetic Breakdown */}
                <div className="p-3 bg-card border rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-foreground">Commercial Totals Breakdown</div>
                  <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t">
                    <div>
                      <span className="text-muted-foreground">Subtotal:</span>
                      <div className="font-medium">
                        {currency} {diff.v1Subtotal} → {currency} {diff.v2Subtotal} ({diff.subtotalDifference})
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Discount:</span>
                      <div className="font-medium">
                        {currency} {diff.v1Discount} → {currency} {diff.v2Discount} ({diff.discountDifference})
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tax:</span>
                      <div className="font-medium">
                        {currency} {diff.v1Tax} → {currency} {diff.v2Tax} ({diff.taxDifference})
                      </div>
                    </div>
                  </div>
                </div>

                {/* Itinerary Linkage Notice */}
                {diff.hasItineraryChange && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg flex items-center gap-2 text-xs text-blue-800 dark:text-blue-300">
                    <AlertCircle className="h-4 w-4 shrink-0 text-blue-600" />
                    <span>
                      <strong>Itinerary Changed:</strong> v{diff.v2VersionNumber} attaches to a different itinerary version than v{diff.v1VersionNumber}.
                    </span>
                  </div>
                )}

                {/* Line Item Changes Table */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">Line Item Differences ({diff.itemDiffs.length})</div>
                  <div className="space-y-2">
                    {diff.itemDiffs.map((item) => (
                      <div
                        key={item.itemId}
                        className="p-3 bg-card border rounded-lg space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                item.changeType === 'added'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : item.changeType === 'removed'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                                  : item.changeType === 'modified'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {item.changeType}
                            </span>
                            <span className="font-semibold text-foreground">{item.title}</span>
                          </div>
                          <span className="text-[10px] uppercase font-mono text-muted-foreground">
                            {item.category}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-muted-foreground pt-1 border-t text-[11px]">
                          <div>
                            {item.changeType === 'added' && (
                              <span>Added: Qty {item.v2Quantity} @ {currency} {item.v2UnitPrice}</span>
                            )}
                            {item.changeType === 'removed' && (
                              <span>Removed: Qty {item.v1Quantity} @ {currency} {item.v1UnitPrice}</span>
                            )}
                            {item.changeType === 'modified' && (
                              <span>
                                Qty {item.v1Quantity} → {item.v2Quantity} • Unit: {currency} {item.v1UnitPrice} → {currency} {item.v2UnitPrice}
                              </span>
                            )}
                            {item.changeType === 'unchanged' && (
                              <span>Qty {item.v1Quantity} @ {currency} {item.v1UnitPrice}</span>
                            )}
                          </div>
                          <div className="font-medium text-foreground">
                            {item.priceDifference && (
                              <span
                                className={
                                  item.priceDifference.startsWith('-')
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : item.priceDifference === '0.00'
                                    ? 'text-muted-foreground'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }
                              >
                                {!item.priceDifference.startsWith('-') && item.priceDifference !== '0.00' ? '+' : ''}
                                {currency} {item.priceDifference}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CUSTOMER EXPLANATION */}
            {activeTab === 'customer' && (
              <div className="space-y-4">
                {/* Executive Summary */}
                <div className="p-3 bg-card border rounded-lg space-y-1">
                  <div className="text-xs font-semibold text-foreground">Executive Summary</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {explanation.executiveSummary}
                  </p>
                </div>

                {/* Key Price Drivers */}
                <div className="p-3 bg-card border rounded-lg space-y-2">
                  <div className="text-xs font-semibold text-foreground">Key Price Drivers</div>
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                    {explanation.keyPriceDrivers.map((driver, i) => (
                      <li key={i}>{driver}</li>
                    ))}
                  </ul>
                </div>

                {/* Scope Changes */}
                {explanation.scopeChanges.length > 0 && (
                  <div className="p-3 bg-card border rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-foreground">Scope Changes</div>
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                      {explanation.scopeChanges.map((sc, i) => (
                        <li key={i}>{sc}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Client-Facing Copy Box */}
                <div className="p-4 bg-muted/20 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <span>Client-Facing Explanation (Customer-Safe)</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyCustomerCopy}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      {hasCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{hasCopied ? 'Copied!' : 'Copy to Clipboard'}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-background border rounded text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {explanation.clientFacingExplanation}
                  </div>
                  <p className="text-[10px] text-muted-foreground italic">
                    This prose was generated from customer-safe facts only and contains zero supplier costs or internal margins.
                  </p>
                </div>
              </div>
            )}

            {/* TAB 3: INTERNAL ANALYSIS (ONLY SHOWN IF AUTHORIZED) */}
            {activeTab === 'internal' && hasInternalPricing && (
              <div className="space-y-4">
                <div className="p-3 bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-300">
                    <Lock className="h-4 w-4" />
                    <span>Internal Financial Strategy & Margin Analysis</span>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300/80 leading-relaxed">
                    {explanation.internalStaffNotes || 'No internal notes available.'}
                  </p>
                </div>

                {/* Internal Cost & Margin Diffs */}
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 bg-card border rounded-lg">
                    <div className="text-[10px] text-muted-foreground uppercase font-medium">Internal Cost Change</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      {diff.internalCostDifference != null
                        ? `${currency} ${diff.internalCostDifference}`
                        : 'N/A'}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      v{diff.v1VersionNumber}: {currency} {diff.v1InternalCostTotal || '0.00'} → v{diff.v2VersionNumber}: {currency} {diff.v2InternalCostTotal || '0.00'}
                    </div>
                  </div>

                  <div className="p-3 bg-card border rounded-lg">
                    <div className="text-[10px] text-muted-foreground uppercase font-medium">Gross Margin Change</div>
                    <div className="text-sm font-bold text-foreground mt-0.5">
                      {diff.grossMarginDifference != null
                        ? `${currency} ${diff.grossMarginDifference}`
                        : 'N/A'}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      v{diff.v1VersionNumber}: {currency} {diff.v1GrossMarginAmount || '0.00'} → v{diff.v2VersionNumber}: {currency} {diff.v2GrossMarginAmount || '0.00'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-muted/10 flex items-center justify-between">
            {metadata?.latencyMs ? (
              <span className="text-[10px] text-muted-foreground">
                Generated in {(metadata.latencyMs / 1000).toFixed(1)}s ({metadata.model})
              </span>
            ) : <span />}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
