'use client';

/**
 * Phase AI-5B.5: Acceptance & Booking Workspace Component
 *
 * Provides staff UI for:
 * - Derived Commercial Acceptance status and historical audit
 * - Pinned accepted QuoteVersion and ItineraryVersion display
 * - Governed Manual Acceptance recording (Admin, Manager, Consultant, Specialist)
 * - Governed Void Acceptance action (Admin, Manager) with conversion-locking defense
 * - Governed Booking conversion (Admin, Manager) with trip fact and financial handoff
 * - Truthful Booking status and unknown finance rendering (balance = '—')
 * - Cancelled booking immutable single-conversion enforcement
 */

import React, { useState } from 'react';
import {
  QuoteAcceptanceDTO,
  BookingDTO,
  QuoteFamilyDTO,
} from '@/app/actions/inquiry-lifecycle';
import {
  recordManualQuoteAcceptanceAction,
  voidQuoteAcceptanceAction,
  convertAcceptedQuoteToBookingAction,
} from '@/app/actions/quote-acceptance';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import {
  CheckCircle2,
  AlertOctagon,
  Calendar,
  Users,
  Briefcase,
  AlertTriangle,
  X,
  FileCheck,
  UserCheck,
  ShieldAlert,
  Info,
  Lock as LockIcon,
} from 'lucide-react';

interface AcceptanceBookingWorkspaceProps {
  inquiryId: string;
  activeAcceptance: QuoteAcceptanceDTO | null;
  acceptanceHistory: QuoteAcceptanceDTO[];
  booking: BookingDTO | null;
  quotes: QuoteFamilyDTO[];
  userRole: string;
  onRefresh: () => Promise<void>;
}

export function AcceptanceBookingWorkspace({
  activeAcceptance,
  acceptanceHistory,
  booking,
  quotes,
  userRole,
  onRefresh,
}: AcceptanceBookingWorkspaceProps) {
  const canRecordAcceptance = can(userRole, 'quotes:acceptance:record');
  const canVoid = can(userRole, 'quotes:acceptance:void');
  const canConvertBooking = can(userRole, 'bookings:convert');

  // Modals
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);

  // States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Record Form State
  const [recordQuoteVersionId, setRecordQuoteVersionId] = useState('');
  const [recordMethod, setRecordMethod] = useState<'email' | 'whatsapp' | 'phone' | 'in_person' | 'other'>('email');
  const [recordNotes, setRecordNotes] = useState('');
  const [recordTravelerName, setRecordTravelerName] = useState('');
  const [recordTravelerEmail, setRecordTravelerEmail] = useState('');

  // Void Form State
  const [voidReason, setVoidReason] = useState('');

  // Collect all eligible issued quote versions
  const issuedQuoteVersions = quotes.flatMap((q) =>
    q.versions
      .filter((v) => v.status === 'issued')
      .map((v) => ({
        ...v,
        quoteNumber: q.quoteNumber,
      }))
  );

  // Record manual staff acceptance
  const handleRecordAcceptance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordQuoteVersionId) {
      setError('Please select an issued quote version');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await recordManualQuoteAcceptanceAction(recordQuoteVersionId, {
        method: recordMethod,
        notes: recordNotes.trim() || undefined,
        travelerName: recordTravelerName.trim() || undefined,
        travelerEmail: recordTravelerEmail.trim() || undefined,
      });
      await onRefresh();
      setIsRecordModalOpen(false);
      setRecordQuoteVersionId('');
      setRecordNotes('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record acceptance');
    } finally {
      setLoading(false);
    }
  };

  // Void active acceptance
  const handleVoidAcceptance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAcceptance) return;
    if (!voidReason.trim()) {
      setError('Please provide a reason for voiding this acceptance');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await voidQuoteAcceptanceAction(activeAcceptance.id, voidReason.trim());
      await onRefresh();
      setIsVoidModalOpen(false);
      setVoidReason('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to void acceptance');
    } finally {
      setLoading(false);
    }
  };

  // Convert accepted quote to booking
  const handleConvertToBooking = async () => {
    if (!activeAcceptance) return;

    setLoading(true);
    setError(null);
    try {
      await convertAcceptedQuoteToBookingAction(activeAcceptance.id);
      await onRefresh();
      setIsConvertModalOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to convert to booking');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Acceptance & Booking</h3>
          <p className="text-xs text-muted-foreground">
            Commercial offer acceptance provenance and operational booking conversion
          </p>
        </div>

        {/* Record Acceptance Action */}
        {!activeAcceptance && !booking && canRecordAcceptance && issuedQuoteVersions.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setRecordQuoteVersionId(issuedQuoteVersions[0]?.id || '');
              setIsRecordModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <UserCheck className="h-4 w-4" />
            <span>Record Acceptance</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Commercial Acceptance State Card */}
      <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Commercial Acceptance Status</h4>
          </div>
          {activeAcceptance ? (
            <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Accepted
            </span>
          ) : (
            <span className="px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full">
              Not Accepted
            </span>
          )}
        </div>

        {activeAcceptance ? (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-muted/20 p-3 rounded-lg border">
              <div>
                <div className="text-muted-foreground text-[11px]">Accepted Quote</div>
                <div className="font-semibold text-foreground text-xs mt-0.5">
                  {activeAcceptance.quoteNumber} (v{activeAcceptance.quoteVersionNumber})
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Accepted Amount</div>
                <div className="font-bold text-foreground text-xs mt-0.5 text-emerald-700 dark:text-emerald-400">
                  {activeAcceptance.currency} {activeAcceptance.acceptedGrandTotal}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Accepted At</div>
                <div className="font-medium text-foreground text-xs mt-0.5">
                  {formatDate(activeAcceptance.acceptedAt)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Acceptance Channel</div>
                <div className="font-medium text-foreground text-xs mt-0.5 capitalize">
                  {activeAcceptance.acceptanceType === 'traveler_link'
                    ? 'Public Traveler Portal'
                    : `Staff Recorded (${activeAcceptance.staffAcceptanceMethod || 'manual'})`}
                </div>
              </div>
              {activeAcceptance.travelerName && (
                <div>
                  <div className="text-muted-foreground text-[11px]">Confirmed By</div>
                  <div className="font-medium text-foreground text-xs mt-0.5">
                    {activeAcceptance.travelerName}
                  </div>
                </div>
              )}
              {activeAcceptance.itineraryTitle && (
                <div>
                  <div className="text-muted-foreground text-[11px]">Pinned Itinerary</div>
                  <div className="font-medium text-foreground text-xs mt-0.5 truncate">
                    {activeAcceptance.itineraryTitle}
                  </div>
                </div>
              )}
            </div>

            {activeAcceptance.staffReferenceNotes && (
              <div className="p-2.5 bg-muted/10 border rounded text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">Staff Notes:</span>{' '}
                {activeAcceptance.staffReferenceNotes}
              </div>
            )}

            {/* Actions on Active Acceptance */}
            <div className="flex items-center justify-between pt-2">
              {/* Void action */}
              {canVoid && (
                <div>
                  {activeAcceptance.isConverted ? (
                    <span className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                      <LockIcon className="h-3.5 w-3.5" /> Converted acceptance cannot be voided
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsVoidModalOpen(true)}
                      className="px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded border border-red-200 dark:border-red-900 transition-colors"
                    >
                      Void Acceptance
                    </button>
                  )}
                </div>
              )}

              {/* Convert to Booking action */}
              {!booking && canConvertBooking && (
                <button
                  type="button"
                  onClick={() => setIsConvertModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors cursor-pointer"
                >
                  <Briefcase className="h-4 w-4" />
                  <span>Convert to Booking</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-2">
            No quote offer has been commercially accepted yet. When the traveler confirms via a public quote link or staff records manual confirmation, acceptance provenance will appear here.
          </div>
        )}
      </div>

      {/* Operational Booking Card */}
      <div className="p-4 border rounded-xl bg-card shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">Operational Booking</h4>
          </div>
          {booking ? (
            <span
              className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                booking.bookingStatus === 'cancelled'
                  ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              }`}
            >
              {booking.bookingStatus.toUpperCase()}
            </span>
          ) : (
            <span className="px-2.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full">
              No Booking Created
            </span>
          )}
        </div>

        {booking ? (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-muted/20 p-3 rounded-lg border">
              <div>
                <div className="text-muted-foreground text-[11px]">Booking Reference</div>
                <div className="font-bold text-foreground text-sm mt-0.5 font-mono">
                  {booking.bookingReference}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Total Contract Value</div>
                <div className="font-bold text-foreground text-xs mt-0.5">
                  {booking.currency} {booking.totalAmount}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Payment Status</div>
                <div className="font-medium text-amber-700 dark:text-amber-400 text-xs mt-0.5 capitalize">
                  {booking.paymentStatus} (Pending ledger)
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Trip Dates</div>
                <div className="font-medium text-foreground text-xs mt-0.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  {booking.departureDate ? formatDate(booking.departureDate) : '—'}
                  {booking.returnDate ? ` to ${formatDate(booking.returnDate)}` : ''}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Travelers</div>
                <div className="font-medium text-foreground text-xs mt-0.5 flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  {booking.passengerCount != null ? `${booking.passengerCount} pax` : '—'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-[11px]">Balance Due</div>
                <div className="font-medium text-muted-foreground text-xs mt-0.5">
                  {booking.balanceDue != null ? `${booking.currency} ${booking.balanceDue}` : '—'}
                </div>
              </div>
            </div>

            {booking.bookingStatus === 'cancelled' && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300">
                ⚠️ This booking was cancelled. An inquiry converted to a booking cannot be converted a second time. If new travel is planned, please open a fresh Inquiry.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-2">
            No operational booking has been created for this inquiry. Once a commercial quote is accepted, an authorized manager or administrator can convert it to a booking.
          </div>
        )}
      </div>

      {/* Historical Acceptances Audit (if any voided records exist) */}
      {acceptanceHistory.filter((a) => a.voidedAt !== null).length > 0 && (
        <div className="p-4 border rounded-xl bg-card shadow-sm space-y-3">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <AlertOctagon className="h-3.5 w-3.5 text-red-500" /> Voided Acceptance History
          </h5>
          <div className="space-y-2">
            {acceptanceHistory
              .filter((a) => a.voidedAt !== null)
              .map((a) => (
                <div
                  key={a.id}
                  className="p-2.5 bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/60 rounded-lg text-xs"
                >
                  <div className="flex justify-between font-medium text-foreground">
                    <span>
                      Quote {a.quoteNumber} (v{a.quoteVersionNumber}) — {a.currency} {a.acceptedGrandTotal}
                    </span>
                    <span className="text-red-700 dark:text-red-400 font-semibold">
                      Voided {a.voidedAt ? formatDate(a.voidedAt) : ''}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px] mt-1">
                    Reason: {a.voidReason || 'No reason specified'}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Record Manual Acceptance Modal */}
      {isRecordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border shadow-2xl rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-primary" /> Record Manual Acceptance
              </h4>
              <button
                type="button"
                onClick={() => setIsRecordModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Record that the traveler has commercially accepted an issued quote offer through an offline or staff communication channel.
            </p>

            <form onSubmit={handleRecordAcceptance} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Select Issued Quote Version *
                </label>
                <select
                  required
                  value={recordQuoteVersionId}
                  onChange={(e) => setRecordQuoteVersionId(e.target.value)}
                  className="w-full text-xs bg-background border rounded-md px-3 py-2 font-medium"
                >
                  {issuedQuoteVersions.map((qv) => (
                    <option key={qv.id} value={qv.id}>
                      {qv.quoteNumber} (v{qv.versionNumber}) — {qv.currency} {qv.grandTotal}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Acceptance Method *
                </label>
                <select
                  value={recordMethod}
                  onChange={(e) =>
                    setRecordMethod(
                      e.target.value as 'email' | 'whatsapp' | 'phone' | 'in_person' | 'other'
                    )
                  }
                  className="w-full text-xs bg-background border rounded-md px-3 py-2 font-medium"
                >
                  <option value="email">Email Confirmation</option>
                  <option value="phone">Phone / Verbal Call</option>
                  <option value="whatsapp">WhatsApp Message</option>
                  <option value="in_person">In-Person Meeting</option>
                  <option value="other">Signed Document / Other</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Traveler Name
                  </label>
                  <input
                    type="text"
                    value={recordTravelerName}
                    onChange={(e) => setRecordTravelerName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full text-xs bg-background border rounded px-3 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Traveler Email
                  </label>
                  <input
                    type="email"
                    value={recordTravelerEmail}
                    onChange={(e) => setRecordTravelerEmail(e.target.value)}
                    placeholder="traveler@example.com"
                    className="w-full text-xs bg-background border rounded px-3 py-1.5"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Staff Reference Notes
                </label>
                <textarea
                  rows={2}
                  value={recordNotes}
                  onChange={(e) => setRecordNotes(e.target.value)}
                  placeholder="e.g. Confirmed via email thread #1042 on 2026-08-16"
                  className="w-full text-xs bg-background border rounded px-3 py-1.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsRecordModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !recordQuoteVersionId}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? 'Recording...' : 'Confirm Acceptance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Void Acceptance Modal */}
      {isVoidModalOpen && activeAcceptance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border shadow-2xl rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h4 className="text-base font-semibold text-red-600 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" /> Void Acceptance
              </h4>
              <button
                type="button"
                onClick={() => setIsVoidModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Voiding this acceptance marks it inactive. An acceptance that has already been converted to a booking cannot be voided.
            </p>

            <form onSubmit={handleVoidAcceptance} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Reason for Voiding *
                </label>
                <textarea
                  required
                  rows={3}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Traveler requested date change and a revised quote is needed."
                  className="w-full text-xs bg-background border rounded px-3 py-1.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsVoidModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !voidReason.trim()}
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? 'Voiding...' : 'Void Acceptance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Convert to Booking Confirmation Modal */}
      {isConvertModalOpen && activeAcceptance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border shadow-2xl rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-emerald-600" /> Convert to Operational Booking
              </h4>
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 bg-muted/20 border rounded-lg space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accepted Quote:</span>
                <span className="font-semibold text-foreground">
                  {activeAcceptance.quoteNumber} (v{activeAcceptance.quoteVersionNumber})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Contract Value:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  {activeAcceptance.currency} {activeAcceptance.acceptedGrandTotal}
                </span>
              </div>
              {activeAcceptance.travelerName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Traveler:</span>
                  <span className="font-medium text-foreground">{activeAcceptance.travelerName}</span>
                </div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-900 space-y-1">
              <div className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1">
                <Info className="h-3.5 w-3.5" /> What happens next?
              </div>
              <div>• Generates a sequential booking reference (BK-YYYY-NNNN).</div>
              <div>• Atomically transitions Inquiry pipeline stage to <strong>booking_confirmed</strong>.</div>
              <div>• Initial payment status will be marked <strong>Unknown</strong> until financial records are processed.</div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleConvertToBooking}
                className="px-4 py-1.5 text-xs font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
              >
                {loading ? 'Converting...' : 'Confirm & Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
