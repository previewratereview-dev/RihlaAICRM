'use client';

/**
 * Phase AI-5B.5: Itinerary Workspace Component
 *
 * Provides staff UI for:
 * - Listing Itinerary Families and versions
 * - Structured Itinerary creation
 * - Structured draft editing with day-by-day builder
 * - Lock version concurrency conflict handling
 * - Explicit Finalization
 * - Revision creation and Version History
 * - Share link generation and Revocation
 * - Viewer read-only mode
 */

import React, { useState } from 'react';
import {
  ItineraryFamilyDTO,
  createItineraryAction,
  updateItineraryDraftAction,
  finalizeItineraryAction,
  createItineraryRevisionAction,
  createItineraryShareAction,
  revokeItineraryShareAction,
} from '@/app/actions/inquiry-lifecycle';
import { ItineraryVersionEntity, ItineraryItem } from '@/lib/quotes-itineraries/types';
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
  Calendar,
  Users,
  MapPin,
  FileText,
  X,
} from 'lucide-react';

interface ItineraryWorkspaceProps {
  inquiryId: string;
  itineraries: ItineraryFamilyDTO[];
  userRole: string;
  onRefresh: () => Promise<void>;
}

export function ItineraryWorkspace({
  inquiryId,
  itineraries,
  userRole,
  onRefresh,
}: ItineraryWorkspaceProps) {
  const isReadOnly = !can(userRole, 'itineraries:write');
  const canCreate = can(userRole, 'itineraries:write');
  const canFinalize = can(userRole, 'itineraries:write');
  const canRevise = can(userRole, 'itineraries:write');
  const canShare = can(userRole, 'itineraries:share');

  // Selected family & version for viewing/editing
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(
    itineraries[0]?.id || null
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  // Modal / Form states
  const [isCreatingFamily, setIsCreatingFamily] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  const [hasCopiedShareUrl, setHasCopiedShareUrl] = useState(false);

  // Operation loading & error states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concurrencyConflict, setConcurrencyConflict] = useState<string | null>(null);

  // New Itinerary Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [newPax, setNewPax] = useState<number | ''>('');

  // Draft Editor State
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDestination, setDraftDestination] = useState('');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [draftPax, setDraftPax] = useState<number | ''>('');
  const [draftDays, setDraftDays] = useState<ItineraryVersionEntity['days']>([]);
  const [draftInclusions, setDraftInclusions] = useState<string[]>([]);
  const [draftExclusions, setDraftExclusions] = useState<string[]>([]);
  const [newInclusion, setNewInclusion] = useState('');
  const [newExclusion, setNewExclusion] = useState('');

  const selectedFamily = itineraries.find((f) => f.id === selectedFamilyId) || itineraries[0] || null;
  const currentVersion = selectedFamily
    ? selectedFamily.versions.find((v) => v.id === (selectedVersionId || selectedFamily.versions[selectedFamily.versions.length - 1]?.id)) ||
      selectedFamily.versions[selectedFamily.versions.length - 1]
    : null;

  // Initialize draft editor from a version
  const handleOpenDraftEditor = (version: ItineraryVersionEntity) => {
    setDraftTitle(version.title);
    setDraftDestination(version.destinationSummary || '');
    setDraftStartDate(version.startDate || '');
    setDraftEndDate(version.endDate || '');
    setDraftPax(version.passengerCount != null ? version.passengerCount : '');
    setDraftDays(JSON.parse(JSON.stringify(version.days || [])));
    setDraftInclusions([...(version.inclusions || [])]);
    setDraftExclusions([...(version.exclusions || [])]);
    setConcurrencyConflict(null);
    setError(null);
    setIsEditingDraft(true);
  };

  // Create new itinerary family
  const handleCreateItinerary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setError('Please provide an itinerary title');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await createItineraryAction({
        inquiryId,
        title: newTitle.trim(),
        destinationSummary: newDestination.trim() || null,
        startDate: newStartDate || null,
        endDate: newEndDate || null,
        passengerCount: newPax === '' ? null : Number(newPax),
        days: [],
        inclusions: [],
        exclusions: [],
      });
      await onRefresh();
      setSelectedFamilyId(res.itineraryId);
      setSelectedVersionId(res.versionId);
      setIsCreatingFamily(false);
      setNewTitle('');
      setNewDestination('');
      setNewStartDate('');
      setNewEndDate('');
      setNewPax('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create itinerary');
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
      await updateItineraryDraftAction({
        versionId: currentVersion.id,
        expectedLockVersion: currentVersion.lockVersion,
        title: draftTitle.trim() || currentVersion.title,
        destinationSummary: draftDestination.trim() || null,
        startDate: draftStartDate || null,
        endDate: draftEndDate || null,
        passengerCount: draftPax === '' ? null : Number(draftPax),
        days: draftDays,
        inclusions: draftInclusions,
        exclusions: draftExclusions,
      });
      await onRefresh();
      setIsEditingDraft(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('STALE_VERSION')) {
        setConcurrencyConflict('This itinerary was updated by another team member.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Finalize itinerary version
  const handleFinalizeVersion = async () => {
    if (!currentVersion) return;
    if (!window.confirm('Finalizing will freeze this itinerary version and make customer content immutable. Proceed?')) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await finalizeItineraryAction(currentVersion.id);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to finalize itinerary');
    } finally {
      setLoading(false);
    }
  };

  // Create new revision from finalized version
  const handleCreateRevision = async () => {
    if (!currentVersion) return;

    setLoading(true);
    setError(null);
    try {
      const res = await createItineraryRevisionAction(currentVersion.id);
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
      const res = await createItineraryShareAction(versionId);
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
      await revokeItineraryShareAction(shareId);
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

  // Day builder helpers
  const handleAddDay = () => {
    setDraftDays([
      ...draftDays,
      {
        dayNumber: draftDays.length + 1,
        title: `Day ${draftDays.length + 1}`,
        summary: null,
        date: null,
        items: [],
      },
    ]);
  };

  const handleRemoveDay = (index: number) => {
    const updated = draftDays.filter((_, i) => i !== index).map((d, i) => ({
      ...d,
      dayNumber: i + 1,
    }));
    setDraftDays(updated);
  };

  const handleAddItemToDay = (dayIndex: number) => {
    const updated = [...draftDays];
    const targetDay = updated[dayIndex];
    if (!targetDay) return;
    const itemId = `item-${Math.random().toString(36).substring(2, 10)}`;
    targetDay.items = [
      ...(targetDay.items || []),
      {
        id: itemId,
        itemType: 'activity',
        title: 'New Activity',
        description: null,
        location: null,
        startTime: null,
        endTime: null,
      },
    ];
    setDraftDays(updated);
  };

  return (
    <div className="space-y-6">
      {/* Header & New Itinerary Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Itineraries</h3>
          <p className="text-xs text-muted-foreground">
            Structured trip plans and day-by-day programs
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsCreatingFamily(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create Itinerary</span>
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
      {itineraries.length === 0 && !isCreatingFamily && (
        <div className="p-8 text-center border rounded-xl bg-card border-dashed">
          <FileText className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <h4 className="text-sm font-medium text-foreground">No itineraries yet</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Create an itinerary to structure days, activities, dates, and inclusions for this inquiry.
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={() => setIsCreatingFamily(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create First Itinerary</span>
            </button>
          )}
        </div>
      )}

      {/* Create Itinerary Modal / Form */}
      {isCreatingFamily && (
        <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-sm font-semibold">New Itinerary Program</h4>
            <button
              type="button"
              onClick={() => setIsCreatingFamily(false)}
              className="p-1 text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleCreateItinerary} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Program Title *
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. 7-Day Classic Dubai & Desert Safari"
                className="w-full text-xs bg-background border rounded-md px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Destination
                </label>
                <input
                  type="text"
                  value={newDestination}
                  onChange={(e) => setNewDestination(e.target.value)}
                  placeholder="e.g. Dubai, UAE"
                  className="w-full text-xs bg-background border rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Travelers (Pax)
                </label>
                <input
                  type="number"
                  min="1"
                  value={newPax}
                  onChange={(e) => setNewPax(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 2"
                  className="w-full text-xs bg-background border rounded-md px-3 py-2"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={(e) => setNewStartDate(e.target.value)}
                  className="w-full text-xs bg-background border rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  className="w-full text-xs bg-background border rounded-md px-3 py-2"
                />
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
                disabled={loading || !newTitle.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Draft (v1)'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Itinerary Viewer & Inspector */}
      {selectedFamily && currentVersion && (
        <div className="space-y-4">
          {/* Family Tabs if multiple exist */}
          {itineraries.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {itineraries.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setSelectedFamilyId(f.id);
                    setSelectedVersionId(null);
                    setIsEditingDraft(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap transition-colors ${
                    f.id === selectedFamily.id
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-card border-border hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {f.title} (v{f.latestVersionNumber})
                </button>
              ))}
            </div>
          )}

          {/* Current Version Card */}
          <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{currentVersion.title}</h4>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${
                      currentVersion.status === 'finalized'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : currentVersion.status === 'superseded'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {currentVersion.status} (v{currentVersion.versionNumber})
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  {currentVersion.destinationSummary && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {currentVersion.destinationSummary}
                    </span>
                  )}
                  {currentVersion.startDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {formatDate(currentVersion.startDate)}
                      {currentVersion.endDate ? ` – ${formatDate(currentVersion.endDate)}` : ''}
                    </span>
                  )}
                  {currentVersion.passengerCount != null && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {currentVersion.passengerCount} pax
                    </span>
                  )}
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
                  {canFinalize && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleFinalizeVersion}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Finalize Itinerary</span>
                    </button>
                  )}
                </>
              )}

              {currentVersion.status === 'finalized' && (
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
            </div>

            {/* Structured Draft Editor */}
            {isEditingDraft && currentVersion.status === 'draft' && (
              <form onSubmit={handleSaveDraft} className="p-4 bg-muted/20 border rounded-lg space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h5 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Editing Itinerary Draft (v{currentVersion.versionNumber})
                  </h5>
                  <button
                    type="button"
                    onClick={() => setIsEditingDraft(false)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full text-xs bg-background border rounded px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Destination Summary
                    </label>
                    <input
                      type="text"
                      value={draftDestination}
                      onChange={(e) => setDraftDestination(e.target.value)}
                      className="w-full text-xs bg-background border rounded px-3 py-1.5"
                    />
                  </div>
                </div>

                {/* Day-by-Day Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Days & Activities ({draftDays.length})
                    </label>
                    <button
                      type="button"
                      onClick={handleAddDay}
                      className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add Day
                    </button>
                  </div>

                  <div className="space-y-3">
                    {draftDays.map((day, dIdx) => (
                      <div key={dIdx} className="p-3 bg-background border rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs font-bold text-muted-foreground">
                              Day {day.dayNumber}:
                            </span>
                            <input
                              type="text"
                              value={day.title}
                              onChange={(e) => {
                                const updated = [...draftDays];
                                updated[dIdx].title = e.target.value;
                                setDraftDays(updated);
                              }}
                              placeholder="Day Title"
                              className="text-xs bg-transparent border-b border-border/50 px-1 py-0.5 flex-1"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveDay(dIdx)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Items in Day */}
                        <div className="pl-4 space-y-1.5">
                          {(day.items || []).map((item, iIdx) => (
                            <div key={iIdx} className="flex items-center gap-2 text-xs">
                              <select
                                value={item.itemType}
                                onChange={(e) => {
                                  const updated = [...draftDays];
                                  updated[dIdx].items[iIdx].itemType = e.target.value as ItineraryItem['itemType'];
                                  setDraftDays(updated);
                                }}
                                className="bg-muted text-[11px] rounded px-1.5 py-1 border"
                              >
                                <option value="activity">Activity</option>
                                <option value="accommodation">Accommodation</option>
                                <option value="transfer">Transfer</option>
                                <option value="flight">Flight</option>
                                <option value="meal">Meal</option>
                                <option value="other">Other</option>
                              </select>
                              <input
                                type="text"
                                value={item.title}
                                onChange={(e) => {
                                  const updated = [...draftDays];
                                  updated[dIdx].items[iIdx].title = e.target.value;
                                  setDraftDays(updated);
                                }}
                                placeholder="Activity description"
                                className="bg-transparent border rounded px-2 py-1 flex-1 text-xs"
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleAddItemToDay(dIdx)}
                            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1"
                          >
                            <Plus className="h-3 w-3" /> Add item to Day {day.dayNumber}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Inclusions & Exclusions */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Inclusions ({draftInclusions.length})
                    </label>
                    <div className="flex gap-1 mb-2">
                      <input
                        type="text"
                        value={newInclusion}
                        onChange={(e) => setNewInclusion(e.target.value)}
                        placeholder="Add inclusion..."
                        className="text-xs bg-background border rounded px-2 py-1 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newInclusion.trim()) {
                            setDraftInclusions([...draftInclusions, newInclusion.trim()]);
                            setNewInclusion('');
                          }
                        }}
                        className="px-2 py-1 bg-muted text-xs font-semibold rounded border"
                      >
                        Add
                      </button>
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {draftInclusions.map((inc, i) => (
                        <li key={i} className="flex items-center justify-between bg-card p-1.5 rounded border">
                          <span>✓ {inc}</span>
                          <button
                            type="button"
                            onClick={() => setDraftInclusions(draftInclusions.filter((_, idx) => idx !== i))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Exclusions ({draftExclusions.length})
                    </label>
                    <div className="flex gap-1 mb-2">
                      <input
                        type="text"
                        value={newExclusion}
                        onChange={(e) => setNewExclusion(e.target.value)}
                        placeholder="Add exclusion..."
                        className="text-xs bg-background border rounded px-2 py-1 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newExclusion.trim()) {
                            setDraftExclusions([...draftExclusions, newExclusion.trim()]);
                            setNewExclusion('');
                          }
                        }}
                        className="px-2 py-1 bg-muted text-xs font-semibold rounded border"
                      >
                        Add
                      </button>
                    </div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {draftExclusions.map((exc, i) => (
                        <li key={i} className="flex items-center justify-between bg-card p-1.5 rounded border">
                          <span>✗ {exc}</span>
                          <button
                            type="button"
                            onClick={() => setDraftExclusions(draftExclusions.filter((_, idx) => idx !== i))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

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

            {/* Read-Only Content Inspector */}
            {!isEditingDraft && (
              <div className="space-y-3 text-xs">
                {currentVersion.days && currentVersion.days.length > 0 ? (
                  <div className="space-y-2">
                    <div className="font-semibold text-muted-foreground">
                      Daily Schedule ({currentVersion.days.length} Days)
                    </div>
                    <div className="space-y-2">
                      {currentVersion.days.map((day) => (
                        <div key={day.dayNumber} className="p-2.5 bg-muted/10 border rounded-lg">
                          <div className="font-medium text-foreground">
                            Day {day.dayNumber}: {day.title}
                          </div>
                          {day.items && day.items.length > 0 && (
                            <ul className="mt-1.5 space-y-1 pl-3 text-muted-foreground list-disc">
                              {day.items.map((it, idx) => (
                                <li key={idx}>
                                  <span className="capitalize font-medium text-foreground/80">
                                    [{it.itemType}]
                                  </span>{' '}
                                  {it.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground italic">No daily schedule items defined.</div>
                )}
              </div>
            )}
          </div>

          {/* Share Links History */}
          {selectedFamily.shares.length > 0 && (
            <div className="p-4 border rounded-xl bg-card shadow-sm space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" /> Share Links
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
                <Share2 className="h-5 w-5 text-primary" /> Public Share Link Created
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
              A secure 256-bit bearer link has been generated. This link provides read-only access to this finalized itinerary.
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
    </div>
  );
}
