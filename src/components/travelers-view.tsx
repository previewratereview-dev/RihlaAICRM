'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Users, MapPin, Calendar, DollarSign, RotateCcw, Loader2, Search } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { normalizeLeadStatus } from '@/lib/pipeline-status';
import { EmptyState } from '@/components/ui/empty-state';
import type { Lead } from '@/types';

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

export function TravelersView() {
  const leads = useCRMStore((state) => state.leads);
  const team = useCRMStore((state) => state.team);
  const currentUser = useCRMStore((state) => state.currentUser);
  const addLead = useCRMStore((state) => state.addLead);
  const [rebookingId, setRebookingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [repeatOnly, setRepeatOnly] = useState(false);

  const pastTravelers = useMemo(
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

  const handleRebook = async (client: Lead) => {
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

  const totalRepeatClients = pastTravelers.filter((client) => isRepeatClient(client, leads)).length;

  return (
    <div className="h-full w-full overflow-y-auto p-4 lg:p-6 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-foreground tracking-tight">Travelers</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">A curated directory of returning clients, recent trips, and re-booking opportunities.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] items-center">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Total Travelers</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{pastTravelers.length}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Repeat Clients</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{totalRepeatClients}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/80 p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">Re-book Ready</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{pastTravelers.filter((client) => client.dealValue > 0).length}</p>
              </div>
            </div>

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
                <span className="font-medium">Repeat Only</span>
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

        <div className="rounded-3xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Traveler roster</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">Browse confirmed bookings, loyalty clients, and rebooking candidates.</p>
              </div>
              <p className="text-xs text-muted-foreground font-medium">Showing {pastTravelers.length} travelers</p>
            </div>
          </div>

          {pastTravelers.length === 0 ? (
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
                  {pastTravelers.map((client, idx) => (
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
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate text-foreground">{client.destination || 'No destination set'}</span>
                        </div>
                      </td>
                      <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-mono font-medium">
                          <span className="text-foreground">{formatCurrency(client.dealValue || 0)}</span>
                        </div>
                      </td>
                      <td className="border-b border-border/50 px-4 py-3 align-top text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="text-foreground">{formatDate(getLastTripDate(client))}</span>
                        </div>
                      </td>
                      <td className="border-b border-border/50 px-4 py-3 align-top text-right">
                        <button
                          type="button"
                          onClick={() => handleRebook(client)}
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
          )}
        </div>
      </div>
    </div>
  );
}
