'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, MapPin, Calendar, DollarSign, RotateCcw, Loader2, Search } from 'lucide-react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { normalizeLeadStatus } from '@/lib/pipeline-status';
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

export function ClientsView() {
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
        budget: client.budget || '$5,000',
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

  return (
    <div className="h-full w-full overflow-y-auto p-6 lg:p-8 scrollbar-thin">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight font-heading">Past Travelers</h2>
            <p className="text-sm text-muted-foreground font-medium mt-1">Returning clients and loyalty history.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRepeatOnly(!repeatOnly)}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-sm transition-colors shadow-sm ${
                repeatOnly
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-card/80 border-border/60 text-foreground hover:border-primary/40'
              }`}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="font-medium">Repeat Only</span>
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search clients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 w-56 rounded-xl border border-input bg-card/80 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-card/80 border border-border/60 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">Client Directory</h3>
                <p className="text-xs text-muted-foreground font-medium mt-1">Travel history and repeat guest records.</p>
              </div>
            </div>
          </div>

          {pastTravelers.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground font-mono text-sm">
              No past travelers yet. Clients appear here once a lead is marked as closed won.
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pastTravelers.map((client, idx) => (
                <motion.div
                  key={client.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="p-5 rounded-2xl border border-border/60 bg-secondary/20 hover:bg-secondary/30 transition-colors space-y-4"
                >
                  <div>
                    <h4 className="font-semibold text-foreground text-lg">{client.fullName}</h4>
                    {isRepeatClient(client, leads) && (
                      <span className="inline-block mt-1 text-[10px] font-mono uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Repeat Client
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-foreground font-medium truncate">
                        {client.destination || client.businessName || 'No destination'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <DollarSign className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatCurrency(client.dealValue || 0)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span>Last trip: {formatDate(getLastTripDate(client))}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRebook(client)}
                    disabled={rebookingId === client.id}
                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {rebookingId === client.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    Re-book
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
