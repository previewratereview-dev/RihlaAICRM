import { describe, it, expect } from 'vitest';
import { normalizeLeadStatus, isClosedStatus } from '@/lib/pipeline-status';
import { evaluateWorkflowRules, DEFAULT_WORKFLOW_RULES } from '@/lib/automation/triggers';
import { cosineSimilarity, fallbackEmbed } from '@/lib/ai/rag';
import type { Lead } from '@/types';

describe('normalizeLeadStatus', () => {
  it('maps legacy statuses to pipeline stages', () => {
    expect(normalizeLeadStatus('new')).toBe('inquiry_received');
    expect(normalizeLeadStatus('closed_won')).toBe('booking_confirmed');
    expect(normalizeLeadStatus('closed_lost')).toBe('booking_lost');
  });

  it('passes through canonical statuses', () => {
    expect(normalizeLeadStatus('consultation_booked')).toBe('consultation_booked');
  });
});

describe('isClosedStatus', () => {
  it('detects closed bookings', () => {
    expect(isClosedStatus('closed_won')).toBe(true);
    expect(isClosedStatus('booking_lost')).toBe(true);
    expect(isClosedStatus('inquiry_received')).toBe(false);
  });
});

describe('evaluateWorkflowRules', () => {
  const hotLead = {
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
    departureDate: '',
    returnDate: '',
    duration: '',
    travelClass: 'business',
    budget: '$10000',
    dealValue: 12000,
    status: 'inquiry_received',
    priority: 'high',
    assignedTo: 'u1',
    tags: [],
    aiScore: 85,
    aiSummary: '',
    specialRequests: '',
    sourceOfDiscovery: '',
    lastContacted: '',
    nextFollowUp: '',
    tenantId: 'test-tenant',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Lead;

  it('matches hot lead rule on create', () => {
    const matched = evaluateWorkflowRules(DEFAULT_WORKFLOW_RULES, 'lead.created', hotLead);
    expect(matched.some((r) => r.id === 'hot-lead-assign')).toBe(true);
  });

  it('does not match cold leads', () => {
    const cold = { ...hotLead, aiScore: 40 };
    const matched = evaluateWorkflowRules(DEFAULT_WORKFLOW_RULES, 'lead.created', cold);
    expect(matched.some((r) => r.id === 'hot-lead-assign')).toBe(false);
  });
});

describe('rag utilities', () => {
  it('computes cosine similarity', () => {
    const a = fallbackEmbed('maldives honeymoon booking');
    const b = fallbackEmbed('maldives honeymoon booking');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 1);
  });
});

describe('injectSystemPrompt', () => {
  it('prepends system prompt when provided', async () => {
    const { injectSystemPrompt } = await import('@/lib/ai/route-helper');
    const result = injectSystemPrompt('You are a travel agent.', 'Hello');
    expect(result).toContain('You are a travel agent.');
    expect(result).toContain('Hello');
  });
});
