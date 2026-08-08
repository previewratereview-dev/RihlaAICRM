'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { RotateCcw, Loader2, Search, Plus, AlertCircle, RefreshCw } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { normalizeLeadStatus } from '@/lib/pipeline-status';
import { EmptyState } from '@/components/ui/empty-state';
import { isNewTravelersReadEnabled } from '@/lib/feature-flags';
import { scoped } from '@/lib/data/scoped';
import { LeadFormModal } from '@/components/leads/lead-form-modal';
import type { LeadFormData } from '@/lib/schemas';
import type { Lead, TravelerDirectoryItem, TravelerKPIs } from '@/types';

function getLastTripDate(lead: Lead): string {
  if (lead.returnDate) return lead.returnDate;
  if (lead.departureDate) return lead.departureDate;
  if (lead.updatedAt) return lead.updatedAt;
  return lead.createdAt;
}

function isRepeatClient(lead: Lead, allLeads: Lead[]): boolean {
  if (lead.tags?.some((t) => t.toLowerCase().includes('repeat'))) return true;
  const key = lead.email?.toLowerCase() || lead.phone;
  if (!key) return false;
  return allLeads.some(
    (other) =>
      other.id !== lead.id &&
      normalizeLeadStatus(other.status) === 'booking_confirmed' &&
      (other.email?.toLowerCase() === lead.email?.toLowerCase() || (lead.phone && other.phone === lead.phone))
  );
}

export interface TravelersViewProps {
  useNewReadOverride?: boolean;
}

export function TravelersView({ useNewReadOverride }: TravelersViewProps = {}) {
  const isNewReadActive = useNewReadOverride ?? isNewTravelersReadEnabled();

  const leads = useCRMStore((state) => state.leads);
  const team = useCRMStore((state) => state.team);
  const currentUser = useCRMStore((state) => state.currentUser);
  const addLead = useCRMStore((state) => state.addLead);

  const [rebookingId, setRebookingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [repeatOnly, setRepeatOnly] = useState(false);

  // New Inquiry Modal state
  const [selectedTravelerForInquiry, setSelectedTravelerForInquiry] = useState<TravelerDirectoryItem | null>(null);
  const [isInquiryModalOpen, setIsInquiryModalOpen] = useState(false);
  const [inquiryFormError, setInquiryFormError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Entity Read State
  const [newTravelers, setNewTravelers] = useState<TravelerDirectoryItem[]>([]);
  const [kpis, setKpis] = useState<TravelerKPIs>({ totalTravelers: 0, repeatTravelers: 0, activeCustomers: 0 });
  const [isLoadingNew, setIsLoadingNew] = useState(false);
  const [errorNew, setErrorNew] = useState<string | null>(null);

  const tenantId = currentUser?.tenantId;

  const [refreshCounter, setRefreshCounter] = useState(0);

  const fetchNewTravelersData = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      if (!isNewReadActive || !tenantId) return;
      setIsLoadingNew(true);
      setErrorNew(null);
      try {
        const client = scoped(tenantId);
        const [listData, kpiData] = await Promise.all([
          client.travelers.list(),
          client.travelers.getKPIs(),
        ]);
        if (!isCancelled) {
          setNewTravelers(listData);
          setKpis(kpiData);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          console.error('[TravelersView] Failed to fetch new travelers data:', err);
          const msg = err instanceof Error ? err.message : 'Failed to load traveler profiles';
          setErrorNew(msg);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingNew(false);
        }
      }
    }

    loadData();

    return () => {
      isCancelled = true;
    };
  }, [isNewReadActive, tenantId, refreshCounter]);

  // Legacy filtering
  const pastTravelersLegacy = useMemo(
    () =>
      leads
        .filter((lead) => {
          if (normalizeLeadStatus(lead.status) !== 'booking_confirmed' && !isRepeatClient(lead, leads)) return false;
          if (repeatOnly && !isRepeatClient(lead, leads)) return false;
          if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            return (
              lead.fullName.toLowerCase().includes(q) ||
              (lead.email?.toLowerCase().includes(q)) ||
              (lead.destination?.toLowerCase().includes(q)) ||
              (lead.businessName?.toLowerCase().includes(q))
            );
          }
          return true;
        })
        .sort((a, b) => new Date(getLastTripDate(b)).getTime() - new Date(getLastTripDate(a)).getTime()),
    [leads, searchTerm, repeatOnly]
  );

  // New Directory filtering
  const filteredNewTravelers = useMemo(() => {
    return newTravelers.filter((t) => {
      if (repeatOnly && t.bookingsCount < 2) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const nameMatch = t.displayName.toLowerCase().includes(q);
        const emailMatch = t.email ? t.email.toLowerCase().includes(q) : false;
        const phoneMatch = t.phone ? t.phone.includes(q) : false;
        const normPhoneMatch = t.normalizedPhone ? t.normalizedPhone.includes(q) : false;
        return nameMatch || emailMatch || phoneMatch || normPhoneMatch;
      }
      return true;
    });
  }, [newTravelers, repeatOnly, searchTerm]);

  // Legacy rebook handler
  const handleRebookLegacy = async (client: Lead) => {
    setRebookingId(client.id);
    try {
      await addLead({
        fullName: client.fullName,
        email: client.email,
        phone: client.phone,
        whatsapp: client.whatsapp || client.phone,
        leadSource: 'referral',
        tripType: client.tripType || 'Family Vacation',
        destination: client.destination,
        country: client.country || '',
        city: client.city || '',
        numberOfTravelers: client.numberOfTravelers || '1',
        departureDate: '',
        returnDate: '',
        duration: client.duration || '',
        travelClass: client.travelClass || 'economy',
        budget: client.budget || '₹5,000',
        dealValue: client.dealValue || 5000,
        status: 'inquiry_received',
        priority: 'medium',
        assignedTo: client.assignedTo || currentUser?.id || team[0]?.id || '',
        tags: ['Re-book', `Ref: ${client.id}`],
        specialRequests: `Re-booking request from past traveler (${client.fullName}). Previous booking ref: ${client.bookingReference || client.id}.`,
        sourceOfDiscovery: `Returning client — previous trip to ${client.destination || 'unknown destination'}`,
        lastContacted: '',
        nextFollowUp: '',
        businessName: client.businessName,
        website: client.website,
        industry: client.industry,
        linkedin: client.linkedin,
        instagram: client.instagram,
        employeeCount: client.employeeCount,
        monthlyRevenue: client.monthlyRevenue,
        currentSoftware: client.currentSoftware,
        interestedService: client.interestedService,
        painPoints: client.painPoints,
        tenantId: currentUser?.tenantId || '',
      });
    } finally {
      setRebookingId(null);
    }
  };

  // Open New Inquiry modal with preselected traveler
  const handleNewInquiry = (traveler: TravelerDirectoryItem) => {
    setSelectedTravelerForInquiry(traveler);
    setInquiryFormError(null);
    setIsInquiryModalOpen(true);
  };

  // Submit handler for preselected traveler New Inquiry form modal
  const handleSubmitNewInquiry = async (data: LeadFormData) => {
    if (!selectedTravelerForInquiry) return;
    setInquiryFormError(null);
    setRebookingId(selectedTravelerForInquiry.id);
    try {
      await addLead({
        ...data,
        fullName: selectedTravelerForInquiry.displayName,
        email: selectedTravelerForInquiry.email || data.email || '',
        phone: selectedTravelerForInquiry.phone || data.phone || '',
        whatsapp: selectedTravelerForInquiry.phone || data.whatsapp || '',
        leadSource: (data.leadSource || 'referral') as Lead['leadSource'],
        priority: (data.priority || 'medium') as Lead['priority'],
        selectedTravelerId: selectedTravelerForInquiry.id,
        status: 'inquiry_received',
        tenantId: currentUser?.tenantId || '',
      });
      setIsInquiryModalOpen(false);
      setSelectedTravelerForInquiry(null);
      setToastMessage(`Inquiry created successfully for ${selectedTravelerForInquiry.displayName}!`);
      setTimeout(() => setToastMessage(null), 4000);
      if (isNewReadActive) {
        await fetchNewTravelersData();
      }
    } catch (err: unknown) {
      console.error('[TravelersView] addLead failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to create inquiry';
      setInquiryFormError(msg);
      throw err;
    } finally {
      setRebookingId(null);
    }
  };

  const totalRepeatClientsLegacy = pastTravelersLegacy.filter((client) => isRepeatClient(client, leads)).length;

  return (
    <div className="h-full w-full overflow-y-auto p-4 lg:p-6 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-5">
        {toastMessage && (
          <div className="px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-semibold flex items-center justify-between shadow-sm">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-green-600 hover:text-green-800 text-xs font-mono">dismiss</button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-foreground tracking-tight">Travelers</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">
              Customer profiles, travel history, and inquiry activity.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] items-center">
            {/* KPI Cards */}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Total Travelers</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {isNewReadActive ? kpis.totalTravelers : pastTravelersLegacy.length}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Repeat Customers</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {isNewReadActive ? kpis.repeatTravelers : totalRepeatClientsLegacy}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">
                  {isNewReadActive ? 'Active Customers' : 'Re-book Ready'}
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {isNewReadActive ? kpis.activeCustomers : pastTravelersLegacy.filter((c) => c.dealValue > 0).length}
                </p>
              </div>
            </div>

            {/* Filter and Search Actions */}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setRepeatOnly(!repeatOnly)}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-sm transition-colors shadow-sm ${
                  repeatOnly
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-card/80 border-border/60 text-foreground hover:border-primary/40'
                }`}
              >
                <RotateCcw className="h-4 w-4" />
                <span className="font-medium">Repeat Customers</span>
              </button>
              <label className="relative block w-full sm:w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search travelers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 w-full rounded-xl border border-input bg-card/80 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Directory Card & Table */}
        <div className="rounded-3xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Traveler directory</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">
                  Customer profiles, travel activity, and value summaries.
                </p>
              </div>
              <p className="text-xs text-muted-foreground font-medium">
                Showing {isNewReadActive ? filteredNewTravelers.length : pastTravelersLegacy.length} travelers
              </p>
            </div>
          </div>

          {/* New Entity Read Implementation */}
          {isNewReadActive ? (
            isLoadingNew ? (
              <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm font-medium">Loading traveler directory...</span>
              </div>
            ) : errorNew ? (
              <div className="flex flex-col items-center justify-center p-12 text-center gap-3">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm font-semibold text-foreground">{errorNew}</p>
                <button
                  type="button"
                  onClick={() => fetchNewTravelersData()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-border/60 text-xs font-semibold text-foreground hover:bg-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            ) : newTravelers.length === 0 ? (
              <EmptyState
                title="No travelers yet."
                description="Traveler profiles will appear as inquiries are created."
                icon="folder"
              />
            ) : filteredNewTravelers.length === 0 ? (
              <EmptyState
                title="No travelers match your search."
                description="Try broadening your search term or clearing filters."
                icon="folder"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-card/80 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="border-b border-border/60 px-4 py-3">Traveler</th>
                      <th className="border-b border-border/60 px-4 py-3">Contact</th>
                      <th className="border-b border-border/60 px-4 py-3">Inquiries</th>
                      <th className="border-b border-border/60 px-4 py-3">Bookings</th>
                      <th className="border-b border-border/60 px-4 py-3">Latest Destination</th>
                      <th className="border-b border-border/60 px-4 py-3">Customer Value</th>
                      <th className="border-b border-border/60 px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNewTravelers.map((traveler, idx) => (
                      <tr
                        key={traveler.id}
                        className={idx % 2 === 0 ? 'bg-white/90' : 'bg-card/80'}
                      >
                        {/* Traveler Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground truncate block">{traveler.displayName}</span>
                              {traveler.hasIdentityReview && (
                                <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 border border-amber-500/20 whitespace-nowrap">
                                  Identity Review
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Contact Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                          <div className="flex flex-col gap-0.5">
                            {traveler.email ? (
                              <span className="text-xs text-foreground truncate block">{traveler.email}</span>
                            ) : null}
                            {traveler.phone ? (
                              <span className="text-xs text-muted-foreground truncate block">{traveler.phone}</span>
                            ) : null}
                            {!traveler.email && !traveler.phone && <span>—</span>}
                          </div>
                        </td>

                        {/* Inquiries Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top font-mono text-foreground font-medium">
                          {traveler.inquiriesCount}
                        </td>

                        {/* Bookings Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top font-mono text-foreground font-medium">
                          {traveler.bookingsCount}
                        </td>

                        {/* Latest Destination Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                          <span className="truncate text-foreground">{traveler.latestDestination || '—'}</span>
                        </td>

                        {/* Customer Value Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top font-mono font-medium">
                          {traveler.customerValue !== null && traveler.customerValue !== undefined ? (
                            <span className="text-foreground">{formatCurrency(traveler.customerValue)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Action Column */}
                        <td className="border-b border-border/50 px-4 py-3 align-top text-right">
                          <button
                            type="button"
                            onClick={() => handleNewInquiry(traveler)}
                            disabled={rebookingId === traveler.id}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-slate-200 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {rebookingId === traveler.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            New Inquiry
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Legacy Read Implementation */
            pastTravelersLegacy.length === 0 ? (
              <EmptyState
                title="No Past Travelers"
                description="Clients appear here once a lead is marked as confirmed or closed won."
                icon="folder"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="bg-card/80 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <th className="border-b border-border/60 px-4 py-3">Traveler</th>
                      <th className="border-b border-border/60 px-4 py-3">Destination</th>
                      <th className="border-b border-border/60 px-4 py-3">Booked Value</th>
                      <th className="border-b border-border/60 px-4 py-3">Last Trip</th>
                      <th className="border-b border-border/60 px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastTravelersLegacy.map((client, idx) => (
                      <tr
                        key={client.id}
                        className={idx % 2 === 0 ? 'bg-white/90' : 'bg-card/80'}
                      >
                        <td className="border-b border-border/50 px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-foreground truncate block">{client.fullName}</span>
                            <span className="text-xs text-muted-foreground truncate block">{client.businessName || 'Private traveler'}</span>
                            {isRepeatClient(client, leads) && (
                              <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary w-fit">
                                Repeat
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                          <span className="truncate text-foreground">{client.destination || 'No destination set'}</span>
                        </td>
                        <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                          <div className="flex items-center gap-1.5 font-mono font-medium">
                            <span className="text-foreground">{formatCurrency(client.dealValue || 0)}</span>
                          </div>
                        </td>
                        <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                          <span className="text-foreground">{formatDate(getLastTripDate(client))}</span>
                        </td>
                        <td className="border-b border-border/50 px-4 py-3 align-top text-right">
                          <button
                            type="button"
                            onClick={() => handleRebookLegacy(client)}
                            disabled={rebookingId === client.id}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-slate-200 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {rebookingId === client.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                              <RotateCcw className="h-4 w-4 text-muted-foreground" />
                            )}
                            Re-book
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {isInquiryModalOpen && selectedTravelerForInquiry && (
        <LeadFormModal
          isEdit={false}
          defaultValues={{
            fullName: selectedTravelerForInquiry.displayName,
            email: selectedTravelerForInquiry.email || '',
            phone: selectedTravelerForInquiry.phone || '',
            whatsapp: selectedTravelerForInquiry.phone || '',
            selectedTravelerId: selectedTravelerForInquiry.id,
            destination: '',
            leadSource: 'referral',
            tripType: 'Custom Itinerary',
            status: 'inquiry_received',
            priority: 'medium',
            dealValue: 5000,
            numberOfTravelers: '1',
            budget: '₹5,000',
            assignedTo: currentUser?.id || team[0]?.id || '',
          }}
          csvImportMessage={null}
          team={team}
          onSubmit={handleSubmitNewInquiry}
          onClose={() => {
            setIsInquiryModalOpen(false);
            setSelectedTravelerForInquiry(null);
            setInquiryFormError(null);
          }}
          onDismissCsvMessage={() => {}}
          formError={inquiryFormError}
        />
      )}
    </div>
  );
}
