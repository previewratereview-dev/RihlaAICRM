import { describe, it, expect } from 'vitest';
import { analyzeMessageSentiment } from '@/lib/ai/sentiment';
import { predictConversionProbability } from '@/lib/ai/conversion';
import { calculateLeadScore } from '@/lib/ai/lead-scoring';

describe('analyzeMessageSentiment', () => {
  it('detects urgent messages', () => {
    const result = analyzeMessageSentiment('I need this ASAP, please call today');
    expect(result.sentiment).toBe('urgent');
  });

  it('detects positive booking intent', () => {
    const result = analyzeMessageSentiment('Yes, we want to book the Maldives package!');
    expect(result.sentiment).toBe('positive');
    expect(result.intent).toBe('booking');
  });

  it('detects pricing objections', () => {
    const result = analyzeMessageSentiment('This is too expensive for our budget');
    expect(result.sentiment).toBe('negative');
    expect(result.intent).toBe('pricing');
  });
});

describe('predictConversionProbability', () => {
  it('returns higher probability for hot leads', () => {
    const hot = predictConversionProbability({
      id: '1',
      fullName: 'Test',
      email: 't@test.com',
      phone: '123',
      whatsapp: '',
      leadSource: 'referral',
      tripType: 'honeymoon',
      destination: 'Maldives',
      country: 'US',
      city: 'NYC',
      numberOfTravelers: '2',
      departureDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      returnDate: '',
      duration: '7d',
      travelClass: 'business',
      budget: '$10000',
      dealValue: 12000,
      status: 'interested',
      priority: 'high',
      assignedTo: 'u1',
      tags: [],
      aiScore: 90,
      aiSummary: '',
      specialRequests: 'VIP',
      sourceOfDiscovery: '',
      lastContacted: '',
      nextFollowUp: '',
      tenantId: 'test-tenant',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const cold = predictConversionProbability({
      id: '2',
      fullName: 'Cold',
      email: 'c@test.com',
      phone: '',
      whatsapp: '',
      leadSource: 'other',
      tripType: 'solo',
      destination: '',
      country: '',
      city: '',
      numberOfTravelers: '1',
      departureDate: '',
      returnDate: '',
      duration: '',
      travelClass: 'economy',
      budget: '$500',
      dealValue: 500,
      status: 'new',
      priority: 'low',
      assignedTo: '',
      tags: [],
      aiScore: 40,
      aiSummary: '',
      specialRequests: '',
      sourceOfDiscovery: '',
      lastContacted: '',
      nextFollowUp: '',
      tenantId: 'test-tenant',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(hot).toBeGreaterThan(cold);
  });
});

describe('calculateLeadScore', () => {
  it('scores high-value urgent trips higher', () => {
    const score = calculateLeadScore({
      dealValue: 15000,
      departureDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      numberOfTravelers: 4,
      specialRequests: 'Need wheelchair access and private transfers for the whole family',
      phone: '+15550100',
      tripType: 'family',
      travelClass: 'business',
      leadSource: 'referral',
      createdAt: new Date().toISOString(),
    });
    expect(score.percentage).toBeGreaterThan(75);
    expect(score.breakdown.length).toBeGreaterThan(0);
  });
});
