/**
 * StateAI AI Operating System (AIOS) — Query Rewriting Engine
 * 
 * Pre-processes natural language user queries before retrieval.
 * Extracts structured metadata filters (e.g., city, status, tier) and expands
 * search keywords to significantly boost RAG retrieval accuracy.
 */

import type { QueryRewriteResult } from './types';

export class QueryRewriter {
  /**
   * Rewrite a natural language query into an optimized search representation with extracted filters.
   */
  async rewrite(query: string, contextMetadata: Record<string, unknown> = {}): Promise<QueryRewriteResult> {
    const filters: Record<string, unknown> = {};
    const keywords: string[] = [];
    let cleanQuery = query;

    // 1. Detect location / city filters (e.g., "from London", "in Dubai", "at New York")
    const cityRegex = /\b(?:from|in|at)\s+([A-Z][a-zA-Z\s]+?)(?:\s+$|\s+(?:regarding|for|with|about|and|or|contact|booking|lead|customer|client))/i;
    const cityMatch = cityRegex.exec(query);
    if (cityMatch) {
      const city = cityMatch[1].trim().toLowerCase();
      if (city.length > 2) {
        filters.city = city;
        cleanQuery = cleanQuery.replace(cityMatch[0], ' ');
      }
    }

    // 2. Detect status filters (e.g., "active customers", "vip leads", "cancelled bookings")
    const statusWords = ['active', 'vip', 'new', 'qualified', 'cancelled', 'confirmed', 'pending'];
    for (const status of statusWords) {
      const statusRegex = new RegExp(`\\b${status}\\b`, 'i');
      if (statusRegex.test(query)) {
        filters.status = status.toLowerCase();
        keywords.push(status.toLowerCase());
      }
    }

    // 3. Extract core domain keywords (customers, leads, flights, hotels, invoices, sops)
    const domainTerms = [
      'customer', 'customers', 'client', 'clients', 'lead', 'leads',
      'booking', 'bookings', 'reservation', 'reservations', 'flight', 'flights',
      'hotel', 'hotels', 'room', 'rooms', 'invoice', 'invoices', 'sop', 'policy', 'guideline',
    ];

    const entityTypes = new Set<string>();
    const tokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const cleanToken = token.replace(/[^a-z0-9]/g, '');
      if (cleanToken.length > 2 && !['the', 'and', 'for', 'show', 'find', 'get', 'list', 'all', 'with', 'about'].includes(cleanToken)) {
        keywords.push(cleanToken);
      }
      if (domainTerms.includes(cleanToken)) {
        if (['customer', 'customers', 'client', 'clients', 'lead', 'leads'].includes(cleanToken)) {
          entityTypes.add('customer');
        } else if (['booking', 'bookings', 'reservation', 'reservations'].includes(cleanToken)) {
          entityTypes.add('booking');
        } else if (['hotel', 'hotels', 'room', 'rooms'].includes(cleanToken)) {
          entityTypes.add('hotel');
        } else if (['flight', 'flights'].includes(cleanToken)) {
          entityTypes.add('flight');
        }
      }
    }

    if (entityTypes.size > 0) {
      filters.entityTypes = Array.from(entityTypes);
    }

    const rewrittenQuery = keywords.join(' ') || query;

    return {
      originalQuery: query,
      rewrittenQuery,
      filters,
      keywords: Array.from(new Set(keywords)),
    };
  }
}

export const defaultQueryRewriter = new QueryRewriter();
