'use client';

import React, { useState } from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { LeadStatus, Priority, LeadSource, CreateLeadDTO } from '@/types';
import { Wrench, ChevronUp, ChevronDown } from 'lucide-react';

/**
 * Development-Only Debug Tools
 *
 * Strictly guards against rendering in production (process.env.NODE_ENV !== 'development').
 * Positioned on the bottom-left to avoid obscuring GlobalCopilot (bottom-right) or Toaster notifications.
 */
export function DevTools() {
  const [isOpen, setIsOpen] = useState(false);
  const addLead = useCRMStore((state) => state.addLead);

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const handleSeed = async () => {
    const priorities: Priority[] = ['urgent', 'high', 'medium', 'low', 'medium', 'medium'];
    const stages: LeadStatus[] = [
      'inquiry_received', 'initial_contact', 'options_shared',
      'consultation_booked', 'itinerary_sent', 'follow_up',
      'customizing_package', 'booking_confirmed', 'booking_lost'
    ];
    const destinations = ['Bali', 'Paris', 'Tokyo', 'New York', 'London', 'Dubai', 'Rome', '', 'Maldives'];
    const names = ['John Doe', 'Jane Smith', 'Alice Johnson', 'Bob Williams', 'Charlie Brown', 'David Lee', 'Eva Green', 'Frank White', 'Grace Hall', 'Henry King', '', 'Long Name Example Very Long'];

    for (let i = 0; i < 35; i++) {
      const stage = stages[Math.floor(Math.random() * stages.length)];
      const priority = priorities[Math.floor(Math.random() * priorities.length)];
      const destination = destinations[Math.floor(Math.random() * destinations.length)];
      const name = names[Math.floor(Math.random() * names.length)];

      const dealValue = Math.random() > 0.3 ? Math.floor(Math.random() * 500000) + 10000 : undefined;

      // Simulate follow up overdue
      const isOverdue = Math.random() > 0.8;
      const nextFollowUp = isOverdue ? new Date(Date.now() - 86400000).toISOString() : new Date(Date.now() + 86400000).toISOString();

      await addLead({
        fullName: name,
        email: `mock${i}@example.com`,
        phone: `+123456789${i}`,
        status: stage,
        priority: priority,
        destination: destination,
        dealValue: dealValue,
        nextFollowUp: nextFollowUp,
        leadSource: 'website' as LeadSource,
      } as unknown as CreateLeadDTO);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col gap-2" data-testid="dev-tools-panel">
      {isOpen ? (
        <div className="bg-background/95 backdrop-blur-md border border-border p-4 shadow-xl rounded-xl flex flex-col gap-2 min-w-[200px]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-muted-foreground">Dev Tools</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={handleSeed} size="sm" variant="secondary" className="w-full text-xs">
            Seed 35 Leads
          </Button>
        </div>
      ) : (
        <Button
          onClick={() => setIsOpen(true)}
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background/90 backdrop-blur-sm border-border shadow-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground font-mono"
        >
          <Wrench className="h-3.5 w-3.5" />
          <span>DevTools</span>
          <ChevronUp className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
