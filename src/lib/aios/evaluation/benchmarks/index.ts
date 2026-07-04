/**
 * StateAI AI Operating System (AIOS) — Permanent AI Benchmark Suite
 * 
 * Curated benchmark test cases across Travel CRM, Healthcare CRM, and Sales CRM
 * to detect regressions and guarantee enterprise quality across updates.
 */

import type { BenchmarkTestCase } from '../interface';

export const travelCRMBenchmarks: BenchmarkTestCase[] = [
  {
    id: 'BENCH-TRV-001',
    category: 'travel_crm',
    query: 'Show active VIP bookings in Dubai for Acme Corp and check flight upgrade SOP',
    expectedDomains: ['crm', 'internal_knowledge'],
    expectedEntities: ['customer', 'booking', 'hotel', 'flight'],
    minContextQuality: 0.85,
    minRetrievalPrecision: 0.80,
  },
  {
    id: 'BENCH-TRV-002',
    category: 'travel_crm',
    query: 'What visa is required for UAE transit for UK citizens?',
    expectedDomains: ['external_knowledge'],
    minContextQuality: 0.80,
    minRetrievalPrecision: 0.85,
  },
  {
    id: 'BENCH-TRV-003',
    category: 'travel_crm',
    query: 'What did Sarah from Acme Corp ask about room preferences yesterday?',
    expectedDomains: ['memory'],
    expectedEntities: ['customer', 'hotel'],
    minContextQuality: 0.85,
  },
];

export const healthcareCRMBenchmarks: BenchmarkTestCase[] = [
  {
    id: 'BENCH-HLTH-001',
    category: 'healthcare_crm',
    query: 'Retrieve patient appointment history and MRI scan report SOP',
    expectedDomains: ['crm', 'internal_knowledge'],
    expectedEntities: ['customer', 'other'],
    minContextQuality: 0.90,
    minRetrievalPrecision: 0.85,
  },
  {
    id: 'BENCH-HLTH-002',
    category: 'healthcare_crm',
    query: 'Verify insurance authorization guidelines for cardiology consultations',
    expectedDomains: ['internal_knowledge'],
    minContextQuality: 0.85,
  },
];

export const salesCRMBenchmarks: BenchmarkTestCase[] = [
  {
    id: 'BENCH-SLS-001',
    category: 'sales_crm',
    query: 'Summarize 360 profile for enterprise lead TechCorp including past WhatsApp chats and invoices',
    expectedDomains: ['crm', 'memory', 'internal_knowledge'],
    expectedEntities: ['company', 'customer', 'invoice'],
    minContextQuality: 0.88,
    minRetrievalPrecision: 0.80,
  },
];

export const allBenchmarks: BenchmarkTestCase[] = [
  ...travelCRMBenchmarks,
  ...healthcareCRMBenchmarks,
  ...salesCRMBenchmarks,
];
