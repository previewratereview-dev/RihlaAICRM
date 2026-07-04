/**
 * StateAI AI Operating System (AIOS) — CRM Context Layer (Priority 4)
 * 
 * Injects active domain entity records (Lead, Booking, Customer, Property, Invoice)
 * relevant to the current conversation or workflow execution.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class CRMLayer implements ContextLayer {
  readonly type = 'crm';
  readonly priority = 4;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { extraData } = options;
    const timestamp = new Date();
    const crmRecords = (extraData?.crmRecords as Array<Record<string, unknown>>) || [];

    return crmRecords.map((record, index) => {
      const recordId = (record.id || record.leadId || record.bookingId || `crm_${index}`) as string;
      const recordType = (record.type || 'CRM Record') as string;
      const contentStr = JSON.stringify(record);

      return {
        id: `ctx_crm_${recordId}`,
        layer: 'crm',
        content: record,
        summary: `${recordType}: ${record.name || record.bookingReference || recordId}`,
        ranking: {
          relevance: 0.9,
          recency: 0.85,
          importance: 0.9,
          confidence: 1.0,
          tokenCost: Math.ceil(contentStr.length / 4) + 10,
        },
        metadata: { recordId, recordType },
        timestamp,
        source: 'aios:crm:database',
      };
    });
  }
}
