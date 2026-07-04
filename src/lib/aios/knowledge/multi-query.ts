/**
 * StateAI AI Operating System (AIOS) — Multi-Query Retrieval Engine
 * 
 * Generates multiple search variations (Original, Synonym, Semantic,
 * Keyword, Abbreviation) from a single query to maximize vector recall
 * before reciprocal rank fusion.
 */

import type { MultiQueryVariation } from './types';

export class MultiQueryRetriever {
  /**
   * Generate 5 distinct query variations to query across vector stores.
   */
  async generateVariations(query: string): Promise<MultiQueryVariation[]> {
    const variations: MultiQueryVariation[] = [
      { type: 'original', query, weight: 1.0 },
    ];

    const lower = query.toLowerCase();

    // 1. Synonym variation
    let synonymQuery = query;
    const synonymMap: Record<string, string> = {
      customer: 'client lead account',
      customers: 'clients leads accounts',
      lead: 'prospect customer',
      booking: 'reservation itinerary order',
      bookings: 'reservations itineraries orders',
      hotel: 'resort accommodation lodging suites',
      flight: 'airline air travel plane',
      policy: 'guideline rule procedure sop',
    };

    for (const [key, syns] of Object.entries(synonymMap)) {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      if (regex.test(synonymQuery)) {
        synonymQuery = synonymQuery.replace(regex, `${key} ${syns}`);
      }
    }
    if (synonymQuery !== query) {
      variations.push({ type: 'synonym', query: synonymQuery, weight: 0.9 });
    }

    // 2. Semantic rephrasing variation
    let semanticQuery = query;
    if (lower.includes('how to') || lower.includes('what is the procedure') || lower.includes('policy on')) {
      semanticQuery = `standard operating procedure instructions SOP guidelines regarding ${query}`;
    } else if (lower.includes('show') || lower.includes('find') || lower.includes('list')) {
      semanticQuery = `database records summary matching ${query}`;
    }
    if (semanticQuery !== query) {
      variations.push({ type: 'semantic', query: semanticQuery, weight: 0.85 });
    }

    // 3. Keyword-only variation (strip stopwords)
    const stopwords = ['the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'with', 'from', 'show', 'find', 'get', 'list', 'all', 'me', 'please'];
    const keywordQuery = query
      .split(/\s+/)
      .filter(w => !stopwords.includes(w.toLowerCase().replace(/[^a-z0-9]/g, '')))
      .join(' ');
    
    if (keywordQuery && keywordQuery !== query) {
      variations.push({ type: 'keyword', query: keywordQuery, weight: 0.8 });
    }

    // 4. Abbreviation expansion variation
    let abbrevQuery = query;
    const abbrevMap: Record<string, string> = {
      vip: 'very important person premium tier',
      sop: 'standard operating procedure',
      crm: 'customer relationship management',
      eta: 'estimated time of arrival',
      inv: 'invoice billing statement',
      pnr: 'passenger name record booking reference',
    };

    for (const [abbr, expansion] of Object.entries(abbrevMap)) {
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      if (regex.test(abbrevQuery)) {
        abbrevQuery = abbrevQuery.replace(regex, `${abbr} (${expansion})`);
      }
    }
    if (abbrevQuery !== query) {
      variations.push({ type: 'abbreviation', query: abbrevQuery, weight: 0.75 });
    }

    return variations;
  }
}

export const defaultMultiQueryRetriever = new MultiQueryRetriever();
