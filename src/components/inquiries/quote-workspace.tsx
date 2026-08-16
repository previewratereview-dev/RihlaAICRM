'use client';

/**
 * Phase AI-5B.5: Quote Workspace Component
 *
 * Provides staff UI for:
 * - Listing Quote Families and versions
 * - Structured Quote creation attaching to a finalized ItineraryVersion
 * - Structured draft editing with line items and quote-level adjustments
 * - Role-Safe Internal Pricing (Admin/Manager see costs/margins; Consultant/Specialist/Viewer receive zero cost data)
 * - Server-aligned Pricing Summary
 * - Lock version concurrency conflict handling
 * - Explicit Issuance
 * - Revision creation and Version History
 * - Share link generation and Revocation
 * - Internal Customer-Safe Preview
 * - Viewer read-only mode
 */

import React, { useState } from 'react';
import {
  QuoteFamilyDTO,
  ItineraryFamilyDTO,
  createQuoteAction,
  updateQuoteDraftAction,
  issueQuoteAction,
  createQuoteRevisionAction,
  createQuoteShareAction,
  revokeQuoteShareAction,
} from '@/app/actions/inquiry-lifecycle';
import {
  InternalQuoteVersionDTO,
  StaffSafeQuoteVersionDTO,
  QuoteLineCategory,
} from '@/lib/quotes-itineraries/types';
import { calculateQuotePricing, PricingLineItemInput } from '@/lib/quotes-itineraries/pricing';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import {
  Plus,
  Edit3,
  CheckCircle2,
  Share2,
  Copy,
  Check,
  AlertTriangle,
  History,
  RotateCcw,
  Trash2,
  DollarSign,
  Eye,
  X,
} from 'lucide-react';

interface QuoteWorkspaceProps {
  inquiryId: string;
  quotes: QuoteFamilyDTO[];
  itineraries: ItineraryFamilyDTO[];
  userRole: string;
  hasInternalPricingPermission: boolean;
  onRefresh: () => Promise<void>;
}

export function QuoteWorkspace({
  inquiryId,
  quotes,
  itineraries,
  userRole,
  hasInternalPricingPermission,
  onRefresh,
}: QuoteWorkspaceProps) {
  const isReadOnly = !can(userRole, 'quotes:write');
  const canCreate = can(userRole, 'quotes:write');
  const canIssue = can(userRole, 'quotes:write');
  const canRevise = can(userRole, 'quotes:write');
  const canShare = can(userRole, 'quotes:share');

  // Selected family & version
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(quotes[0]?.id || null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // Modals
  const [isCreatingFamily, setIsCreatingFamily] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  const [hasCopiedShareUrl, setHasCopiedShareUrl] = useState(false);

  // States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concurrencyConflict, setConcurrencyConflict] = useState<string | null>(null);

  // Create Quote Form State
  const [selectedItinVersionId, setSelectedItinVersionId] = useState<string>('');
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newLineItems, setNewLineItems] = useState<PricingLineItemInput[]>([
    {
      title: 'Standard Travel Package',
      category: 'other',
      quantity: 1,
      unitPrice: '1000.00',
      supplierCost: hasInternalPricingPermission ? '700.00' : null,
    },
  ]);

  // Draft Editor State
  const [draftCurrency, setDraftCurrency] = useState('USD');
  const [draftLineItems, setDraftLineItems] = useState<PricingLineItemInput[]>([]);
  const [draftDiscount, setDraftDiscount] = useState('0.00');
  const [draftTax, setDraftTax] = useState('0.00');
  const [draftValidUntil, setDraftValidUntil] = useState('');
  const [draftTerms, setDraftTerms] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  // Collect all eligible finalized itinerary versions
  const finalizedItinVersions = itineraries.flatMap((f) =>
    f.versions.filter((v) => v.status === 'finalized').map((v) => ({
      ...v,
      familyTitle: f.title,
    }))
  );

  const selectedFamily = quotes.find((q) => q.id === selectedFamilyId) || quotes[0] || null;
  const currentVersion = selectedFamily
    ? selectedFamily.versions.find(
        (v) => v.id === (selectedVersionId || selectedFamily.versions[selectedFamily.versions.length - 1]?.id)
      ) || selectedFamily.versions[selectedFamily.versions.length - 1]
    : null;

  // Initialize draft editor
  const handleOpenDraftEditor = (version: InternalQuoteVersionDTO | StaffSafeQuoteVersionDTO) => {
    setDraftCurrency(version.currency);
    setDraftDiscount(version.discountAmount);
    setDraftTax(version.taxAmount);
    setDraftValidUntil(version.validUntil || '');
    setDraftTerms(version.termsAndConditions || '');
    setDraftNotes(version.customerNotes || '');

    const lines: PricingLineItemInput[] = (version.lineItems || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      supplierCost:
        hasInternalPricingPermission && 'supplierCost' in item && item.supplierCost != null
          ? String(item.supplierCost)
          : null,
      supplierName: item.supplierName,
    }));
    setDraftLineItems(lines);
    setConcurrencyConflict(null);
    setError(null);
    setIsEditingDraft(true);
  };

  // Create new quote family
  const handleCreateQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItinVersionId) {
      setError('Please select a finalized itinerary version');
      return;
    }
    if (newLineItems.length === 0) {
      setError('Please add at least one line item');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await createQuoteAction({
        inquiryId,
        itineraryVersionId: selectedItinVersionId,
        currency: newCurrency,
        lineItems: newLineItems,
        discountAmount: '0.00',
        taxAmount: '0.00',
      });
      await onRefresh();
      setSelectedFamilyId(res.quoteId);
      setSelectedVersionId(res.versionId);
      setIsCreatingFamily(false);
      setSelectedItinVersionId('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create quote');
    } finally {
      setLoading(false);
    }
  };

  // Save draft updates
  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVersion) return;

    setLoading(true);
    setError(null);
    setConcurrencyConflict(null);

    try {
      await updateQuoteDraftAction({
        versionId: currentVersion.id,
        expectedLockVersion: currentVersion.lockVersion,
        currency: draftCurrency,
        lineItems: draftLineItems,
        discountAmount: draftDiscount || '0.00',
        taxAmount: draftTax || '0.00',
        validUntil: draftValidUntil || null,
        termsAndConditions: draftTerms || null,
        customerNotes: draftNotes || null,
      });
      await onRefresh();
      setIsEditingDraft(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('STALE_VERSION')) {
        setConcurrencyConflict('This quote was updated by another team member.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Issue quote version
  const handleIssueVersion = async () => {
    if (!currentVersion) return;
    if (!window.confirm('Issuing freezes commercial pricing and terms. Proceed?')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await issueQuoteAction(currentVersion.id);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to issue quote');
    } finally {
      setLoading(false);
    }
  };

  // Create new revision from issued version
  const handleCreateRevision = async () => {
    if (!currentVersion) return;

    setLoading(true);
    setError(null);
    try {
      const res = await createQuoteRevisionAction(currentVersion.id);
      await onRefresh();
      setSelectedVersionId(res.newVersionId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create revision');
    } finally {
      setLoading(false);
    }
  };

  // Share link issuance
  const handleGenerateShare = async (versionId: string) => {
    setLoading(true);
    setError(null);
    setGeneratedShareUrl(null);
    setHasCopiedShareUrl(false);

    try {
      const res = await createQuoteShareAction(versionId);
      setGeneratedShareUrl(res.shareUrl);
      setIsShareModalOpen(true);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate share link');
    } finally {
      setLoading(false);
    }
  };

  // Revoke share
  const handleRevokeShare = async (shareId: string) => {
    if (!window.confirm('Revoking will immediately deactivate this public link. Continue?')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await revokeQuoteShareAction(shareId);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyShareLink = () => {
    if (generatedShareUrl) {
      navigator.clipboard.writeText(generatedShareUrl);
      setHasCopiedShareUrl(true);
      setTimeout(() => setHasCopiedShareUrl(false), 2500);
    }
  };

  // Live draft pricing preview
  const livePricing = isEditingDraft
    ? calculateQuotePricing({
        lineItems: draftLineItems,
        discountAmount: draftDiscount,
        taxAmount: draftTax,
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Header & New Quote Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Commercial Quotes</h3>
          <p className="text-xs text-muted-foreground">
            Commercial offers, itemized pricing, and client proposals
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              if (finalizedItinVersions.length === 0) {
                setError('A finalized itinerary version is required before creating a quote.');
                return;
              }
              setSelectedItinVersionId(finalizedItinVersions[0]?.id || '');
              setIsCreatingFamily(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create Quote</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {quotes.length === 0 && !isCreatingFamily && (
        <div className="p-8 text-center border rounded-xl bg-card border-dashed">
          <DollarSign className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <h4 className="text-sm font-medium text-foreground">No quotes yet</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Attach a quote to a finalized itinerary to structure commercial prices, margins, and customer terms.
          </p>
          {canCreate && finalizedItinVersions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedItinVersionId(finalizedItinVersions[0]?.id || '');
                setIsCreatingFamily(true);
              }}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Quote</span>
            </button>
          )}
        </div>
      )}

      {/* Create Quote Modal / Form */}
      {isCreatingFamily && (
        <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-sm font-semibold">New Commercial Offer</h4>
            <button
              type="button"
              onClick={() => setIsCreatingFamily(false)}
              className="p-1 text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleCreateQuote} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Select Finalized Itinerary Program *
              </label>
              <select
                required
                value={selectedItinVersionId}
                onChange={(e) => setSelectedItinVersionId(e.target.value)}
                className="w-full text-xs bg-background border rounded-md px-3 py-2 font-medium"
              >
                <option value="">-- Choose Finalized Program --</option>
                {finalizedItinVersions.map((iv) => (
                  <option key={iv.id} value={iv.id}>
                    {iv.familyTitle} (v{iv.versionNumber}) - {iv.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Currency
                </label>
                <select
                  value={newCurrency}
                  onChange={(e) => setNewCurrency(e.target.value)}
                  className="w-full text-xs bg-background border rounded-md px-3 py-2 font-medium"
                >
                  <option value="USD">USD ($)</option>
                  <option value="INR">INR (₹)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED (د.إ)</option>
                </select>
              </div>
            </div>

            {/* Initial Line Item */}
            <div className="p-3 bg-muted/20 border rounded-lg space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Initial Line Item</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  value={newLineItems[0]?.title || ''}
                  onChange={(e) => {
                    const updated = [...newLineItems];
                    updated[0].title = e.target.value;
                    setNewLineItems(updated);
                  }}
                  placeholder="Item Title"
                  className="text-xs bg-background border rounded px-2 py-1.5 col-span-2"
                />
                <select
                  value={newLineItems[0]?.category || 'other'}
                  onChange={(e) => {
                    const updated = [...newLineItems];
                    updated[0].category = e.target.value as QuoteLineCategory;
                    setNewLineItems(updated);
                  }}
                  className="text-xs bg-background border rounded px-2 py-1.5"
                >
                  <option value="accommodation">Accommodation</option>
                  <option value="flight">Flight</option>
                  <option value="transfer">Transfer</option>
                  <option value="activity">Activity</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={newLineItems[0]?.quantity || 1}
                    onChange={(e) => {
                      const updated = [...newLineItems];
                      updated[0].quantity = Number(e.target.value);
                      setNewLineItems(updated);
                    }}
                    className="w-full text-xs bg-background border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Unit Price ({newCurrency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newLineItems[0]?.unitPrice || '0.00'}
                    onChange={(e) => {
                      const updated = [...newLineItems];
                      updated[0].unitPrice = e.target.value;
                      setNewLineItems(updated);
                    }}
                    className="w-full text-xs bg-background border rounded px-2 py-1"
                  />
                </div>
                {hasInternalPricingPermission && (
                  <div>
                    <label className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                      Supplier Cost ({newCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newLineItems[0]?.supplierCost || ''}
                      onChange={(e) => {
                        const updated = [...newLineItems];
                        updated[0].supplierCost = e.target.value;
                        setNewLineItems(updated);
                      }}
                      className="w-full text-xs bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingFamily(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedItinVersionId}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Draft Quote (v1)'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Quote Viewer & Inspector */}
      {selectedFamily && currentVersion && (
        <div className="space-y-4">
          {/* Family Tabs if multiple exist */}
          {quotes.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {quotes.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setSelectedFamilyId(q.id);
                    setSelectedVersionId(null);
                    setIsEditingDraft(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap transition-colors ${
                    q.id === selectedFamily.id
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-card border-border hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {q.quoteNumber} (v{q.latestVersionNumber})
                </button>
              ))}
            </div>
          )}

          {/* Current Quote Version Card */}
          <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    {currentVersion.quoteNumber}
                  </h4>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${
                      currentVersion.status === 'issued'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : currentVersion.status === 'superseded'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {currentVersion.status} (v{currentVersion.versionNumber})
                  </span>
                </div>
                <div className="text-lg font-bold text-foreground mt-1">
                  {currentVersion.currency} {currentVersion.grandTotal}
                </div>
              </div>

              {/* Version Selector */}
              {selectedFamily.versions.length > 1 && (
                <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-md border text-xs">
                  <History className="h-3.5 w-3.5 text-muted-foreground ml-1" />
                  <select
                    value={currentVersion.id}
                    onChange={(e) => {
                      setSelectedVersionId(e.target.value);
                      setIsEditingDraft(false);
                    }}
                    className="bg-transparent border-0 text-xs py-0.5 pr-2 focus:ring-0 cursor-pointer font-medium"
                  >
                    {selectedFamily.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.versionNumber} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {currentVersion.status === 'draft' && !isReadOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => handleOpenDraftEditor(currentVersion)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit Draft</span>
                  </button>
                  {canIssue && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleIssueVersion}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Issue Quote</span>
                    </button>
                  )}
                </>
              )}

              {currentVersion.status === 'issued' && (
                <>
                  {canRevise && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleCreateRevision}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Create Revision (v{currentVersion.versionNumber + 1})</span>
                    </button>
                  )}
                  {canShare && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleGenerateShare(currentVersion.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      <span>Create Share Link</span>
                    </button>
                  )}
                </>
              )}

              {currentVersion.status === 'superseded' && canRevise && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleCreateRevision}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Create Revision from v{currentVersion.versionNumber}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Customer Preview</span>
              </button>
            </div>

            {/* Concurrency conflict message */}
            {concurrencyConflict && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-center justify-between">
                <span>{concurrencyConflict}</span>
                <button
                  type="button"
                  onClick={() => {
                    onRefresh();
                    setIsEditingDraft(false);
                  }}
                  className="underline font-semibold"
                >
                  Reload Latest Version
                </button>
              </div>
            )}

            {/* Structured Draft Editor */}
            {isEditingDraft && currentVersion.status === 'draft' && (
              <form onSubmit={handleSaveDraft} className="p-4 bg-muted/20 border rounded-lg space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h5 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Editing Quote Draft (v{currentVersion.versionNumber})
                  </h5>
                  <button
                    type="button"
                    onClick={() => setIsEditingDraft(false)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Line Items Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Line Items ({draftLineItems.length})
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftLineItems([
                          ...draftLineItems,
                          {
                            title: 'New Service Item',
                            category: 'other',
                            quantity: 1,
                            unitPrice: '100.00',
                            supplierCost: hasInternalPricingPermission ? '70.00' : null,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Item
                    </button>
                  </div>

                  <div className="space-y-2">
                    {draftLineItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-background border rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => {
                              const updated = [...draftLineItems];
                              updated[idx].title = e.target.value;
                              setDraftLineItems(updated);
                            }}
                            placeholder="Line Item Title"
                            className="text-xs bg-transparent border-b font-medium px-1 py-0.5 flex-1"
                          />
                          <select
                            value={item.category}
                            onChange={(e) => {
                              const updated = [...draftLineItems];
                              updated[idx].category = e.target.value as QuoteLineCategory;
                              setDraftLineItems(updated);
                            }}
                            className="text-xs bg-muted border rounded px-2 py-1"
                          >
                            <option value="accommodation">Accommodation</option>
                            <option value="flight">Flight</option>
                            <option value="transfer">Transfer</option>
                            <option value="activity">Activity</option>
                            <option value="visa">Visa</option>
                            <option value="insurance">Insurance</option>
                            <option value="fee">Fee</option>
                            <option value="other">Other</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftLineItems(draftLineItems.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <label className="text-[10px] text-muted-foreground">Qty</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const updated = [...draftLineItems];
                                updated[idx].quantity = Number(e.target.value);
                                setDraftLineItems(updated);
                              }}
                              className="w-full bg-background border rounded px-2 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground">Unit Price ({draftCurrency})</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const updated = [...draftLineItems];
                                updated[idx].unitPrice = e.target.value;
                                setDraftLineItems(updated);
                              }}
                              className="w-full bg-background border rounded px-2 py-1 text-xs"
                            />
                          </div>
                          {hasInternalPricingPermission && (
                            <div>
                              <label className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                                Supplier Cost ({draftCurrency})
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={item.supplierCost || ''}
                                onChange={(e) => {
                                  const updated = [...draftLineItems];
                                  updated[idx].supplierCost = e.target.value;
                                  setDraftLineItems(updated);
                                }}
                                className="w-full bg-amber-50/50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1 text-xs"
                              />
                            </div>
                          )}
                          <div className="flex flex-col justify-end">
                            <span className="text-[10px] text-muted-foreground">Total</span>
                            <span className="font-semibold text-xs py-1">
                              {draftCurrency}{' '}
                              {(
                                (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                              ).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Adjustments & Validity */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Discount ({draftCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={draftDiscount}
                      onChange={(e) => setDraftDiscount(e.target.value)}
                      className="w-full text-xs bg-background border rounded px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Tax ({draftCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={draftTax}
                      onChange={(e) => setDraftTax(e.target.value)}
                      className="w-full text-xs bg-background border rounded px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Valid Until Date
                    </label>
                    <input
                      type="date"
                      value={draftValidUntil}
                      onChange={(e) => setDraftValidUntil(e.target.value)}
                      className="w-full text-xs bg-background border rounded px-2 py-1.5"
                    />
                  </div>
                </div>

                {/* Live Pricing Summary Box */}
                {livePricing && (
                  <div className="p-3 bg-muted/40 border rounded-lg space-y-1.5 text-xs">
                    <div className="font-semibold text-foreground mb-1">Live Pricing Preview</div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal:</span>
                      <span>{draftCurrency} {livePricing.subtotal}</span>
                    </div>
                    {Number(livePricing.discountAmount) > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Discount:</span>
                        <span>- {draftCurrency} {livePricing.discountAmount}</span>
                      </div>
                    )}
                    {Number(livePricing.taxAmount) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Tax:</span>
                        <span>+ {draftCurrency} {livePricing.taxAmount}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-foreground border-t pt-1 text-sm">
                      <span>Grand Total:</span>
                      <span>{draftCurrency} {livePricing.grandTotal}</span>
                    </div>

                    {/* Admin / Manager Internal Margins */}
                    {hasInternalPricingPermission && (
                      <div className="border-t border-amber-200 dark:border-amber-900 pt-1.5 mt-1 text-amber-800 dark:text-amber-300 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span>Internal Cost:</span>
                          <span>
                            {livePricing.internalCostTotal != null
                              ? `${draftCurrency} ${livePricing.internalCostTotal}`
                              : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between font-semibold">
                          <span>Gross Margin:</span>
                          <span>
                            {livePricing.grossMarginAmount != null
                              ? `${draftCurrency} ${livePricing.grossMarginAmount}`
                              : '—'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setIsEditingDraft(false)}
                    className="px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save Draft'}
                  </button>
                </div>
              </form>
            )}

            {/* Read-Only Pricing & Items Breakdown */}
            {!isEditingDraft && (
              <div className="space-y-4">
                {/* Line items table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground border-b">
                      <tr>
                        <th className="p-2 font-medium">Item</th>
                        <th className="p-2 font-medium">Category</th>
                        <th className="p-2 font-medium text-right">Qty</th>
                        <th className="p-2 font-medium text-right">Unit Price</th>
                        {hasInternalPricingPermission && (
                          <th className="p-2 font-medium text-right text-amber-600 dark:text-amber-400">
                            Supplier Cost
                          </th>
                        )}
                        <th className="p-2 font-medium text-right">Total Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(currentVersion.lineItems || []).map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-2 font-medium text-foreground">{item.title}</td>
                          <td className="p-2 text-muted-foreground capitalize">{item.category}</td>
                          <td className="p-2 text-right">{item.quantity}</td>
                          <td className="p-2 text-right">
                            {currentVersion.currency} {item.unitPrice}
                          </td>
                          {hasInternalPricingPermission && (
                            <td className="p-2 text-right text-amber-700 dark:text-amber-300 font-mono">
                              {'supplierCost' in item && item.supplierCost != null
                                ? `${currentVersion.currency} ${item.supplierCost}`
                                : '—'}
                            </td>
                          )}
                          <td className="p-2 text-right font-semibold">
                            {currentVersion.currency} {item.totalPrice}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pricing Summary */}
                <div className="p-3 bg-muted/20 border rounded-lg space-y-1.5 text-xs max-w-sm ml-auto">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span>{currentVersion.currency} {currentVersion.subtotal}</span>
                  </div>
                  {Number(currentVersion.discountAmount) > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Discount:</span>
                      <span>- {currentVersion.currency} {currentVersion.discountAmount}</span>
                    </div>
                  )}
                  {Number(currentVersion.taxAmount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax:</span>
                      <span>+ {currentVersion.currency} {currentVersion.taxAmount}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-foreground border-t pt-1 text-sm">
                    <span>Grand Total:</span>
                    <span>{currentVersion.currency} {currentVersion.grandTotal}</span>
                  </div>

                  {/* Internal pricing summary */}
                  {hasInternalPricingPermission && 'internalCostTotal' in currentVersion && (
                    <div className="border-t border-amber-200 dark:border-amber-900 pt-1.5 mt-1 text-amber-800 dark:text-amber-300 space-y-1">
                      <div className="flex justify-between">
                        <span>Internal Cost:</span>
                        <span>
                          {(currentVersion as InternalQuoteVersionDTO).internalCostTotal != null
                            ? `${currentVersion.currency} ${(currentVersion as InternalQuoteVersionDTO).internalCostTotal}`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span>Gross Margin:</span>
                        <span>
                          {(currentVersion as InternalQuoteVersionDTO).grossMarginAmount != null
                            ? `${currentVersion.currency} ${(currentVersion as InternalQuoteVersionDTO).grossMarginAmount}`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Share Links History */}
          {selectedFamily.shares.length > 0 && (
            <div className="p-4 border rounded-xl bg-card shadow-sm space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> Quote Share Links
              </h5>
              <div className="space-y-2">
                {selectedFamily.shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between p-2.5 bg-muted/20 border rounded-lg text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          Created {formatDate(share.createdAt)}
                        </span>
                        {share.revokedAt ? (
                          <span className="px-1.5 py-0.5 text-[10px] bg-red-100 text-red-800 rounded font-semibold">
                            Revoked
                          </span>
                        ) : share.isExpired ? (
                          <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded font-semibold">
                            Expired
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 rounded font-semibold">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground text-[11px] mt-0.5">
                        Expires: {formatDate(share.expiresAt)}
                        {share.firstViewedAt && ` · First viewed: ${formatDate(share.firstViewedAt)}`}
                      </div>
                    </div>
                    {!share.revokedAt && !share.isExpired && canShare && (
                      <button
                        type="button"
                        onClick={() => handleRevokeShare(share.id)}
                        disabled={loading}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Share Link Modal */}
      {isShareModalOpen && generatedShareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border shadow-2xl rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-primary" /> Public Quote Link Created
              </h4>
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              A secure 256-bit bearer link has been generated. Link holders can view the sanitized quote offer and commercially accept it.
            </p>
            <div className="flex items-center gap-2 bg-muted p-2.5 rounded-lg border">
              <input
                type="text"
                readOnly
                value={generatedShareUrl}
                className="bg-transparent text-xs font-mono text-foreground flex-1 outline-none select-all"
              />
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shrink-0"
              >
                {hasCopiedShareUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Link
                  </>
                )}
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded border border-amber-200 dark:border-amber-900">
              ⚠️ Note: The raw share URL cannot be reconstructed after closing this dialog.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded bg-muted hover:bg-muted/80 text-foreground"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Internal Customer Preview Modal */}
      {isPreviewModalOpen && currentVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border shadow-2xl rounded-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h4 className="text-base font-semibold text-foreground">
                  Customer View Preview: Quote {currentVersion.quoteNumber}
                </h4>
                <p className="text-xs text-muted-foreground">
                  Exact customer-safe representation (internal pricing and costs stripped)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 bg-muted/10 border rounded-lg space-y-3 text-xs">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="font-bold text-sm">Quote {currentVersion.quoteNumber} (v{currentVersion.versionNumber})</span>
                <span className="text-base font-bold text-primary">
                  {currentVersion.currency} {currentVersion.grandTotal}
                </span>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-muted-foreground">Itemized Line Items</div>
                {currentVersion.lineItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-1 border-b border-border/40">
                    <div>
                      <div className="font-medium text-foreground">{item.title}</div>
                      <div className="text-[10px] text-muted-foreground capitalize">
                        {item.category} · Qty {item.quantity} @ {currentVersion.currency} {item.unitPrice}
                      </div>
                    </div>
                    <div className="font-semibold">
                      {currentVersion.currency} {item.totalPrice}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 space-y-1 text-right">
                <div>Subtotal: {currentVersion.currency} {currentVersion.subtotal}</div>
                {Number(currentVersion.discountAmount) > 0 && (
                  <div className="text-red-600">Discount: -{currentVersion.currency} {currentVersion.discountAmount}</div>
                )}
                {Number(currentVersion.taxAmount) > 0 && (
                  <div>Tax: +{currentVersion.currency} {currentVersion.taxAmount}</div>
                )}
                <div className="font-bold text-sm text-foreground pt-1 border-t">
                  Grand Total: {currentVersion.currency} {currentVersion.grandTotal}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded bg-muted hover:bg-muted/80 text-foreground"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
