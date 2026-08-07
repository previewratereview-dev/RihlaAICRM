'use client';

import React from 'react';
import { useCRMStore } from '@/hooks/use-crm-store';
import { Button } from '@/components/ui/button';
import { LeadStatus, Priority, LeadSource, CreateLeadDTO } from '@/types';

export function DevTools() {
  const addLead = useCRMStore((state) => state.addLead);
  
  // if (process.env.NODE_ENV !== 'development') return null;

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
        leadSource: 'website' as LeadSource, // 'manual' isn't in LeadSource type
      } as unknown as CreateLeadDTO);
    }
    console.log('Seeded 35 leads!');
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-background border p-4 shadow-lg rounded-xl flex flex-col gap-2">
      <h3 className="text-sm font-bold">Dev Tools</h3>
      <Button onClick={handleSeed} size="sm">Seed 35 Leads</Button>
    </div>
  );
}
