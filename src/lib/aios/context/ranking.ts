/**
 * StateAI AI Operating System (AIOS) — Multi-Dimensional Context Ranking Engine
 * 
 * Computes composite relevance scores across 4 key dimensions:
 * - Relevance (semantic query alignment or direct keyword overlap)
 * - Recency (exponential time decay based on timestamp)
 * - Importance (architectural and business criticality)
 * - Confidence (source reliability and verification score)
 * 
 * Supports configurable per-tenant weights (e.g., Travel CRM vs Sales CRM).
 */

import type { ContextItem, TenantRankingWeights } from './types';

export class ContextRanker {
  private defaultWeights: TenantRankingWeights = {
    relevance: 0.35,
    recency: 0.25,
    importance: 0.25,
    confidence: 0.15,
  };

  /**
   * Compute composite scores and sort context items descending by value.
   */
  rank(
    items: ContextItem[],
    query?: string,
    customWeights?: TenantRankingWeights
  ): ContextItem[] {
    const weights = customWeights || this.defaultWeights;
    const queryTerms = query ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];

    const scoredItems = items.map(item => {
      let relevance = item.ranking.relevance;

      // Adjust relevance if keyword query is provided and relevance was default
      if (queryTerms.length > 0 && typeof item.content === 'string') {
        const contentLower = item.content.toLowerCase();
        const matchCount = queryTerms.filter(t => contentLower.includes(t)).length;
        const keywordScore = matchCount / queryTerms.length;
        relevance = Math.max(relevance, keywordScore);
      }

      // Compute time decay (recency)
      const now = new Date().getTime();
      const itemTime = new Date(item.timestamp).getTime();
      const hoursOld = Math.max(0, (now - itemTime) / (1000 * 60 * 60));
      const timeDecay = Math.exp(-hoursOld / 72); // Half-life ~72 hours
      const recency = Math.max(item.ranking.recency, Number(timeDecay.toFixed(4)));

      const importance = item.ranking.importance;
      const confidence = item.ranking.confidence;

      // Weighted multi-dimensional composite score
      const compositeScore =
        relevance * weights.relevance +
        recency * weights.recency +
        importance * weights.importance +
        confidence * weights.confidence;

      const score = Number(Math.min(1.0, Math.max(0.0, compositeScore)).toFixed(4));

      return {
        ...item,
        ranking: {
          ...item.ranking,
          relevance,
          recency,
          score,
        },
      };
    });

    // Sort descending by computed score
    return scoredItems.sort((a, b) => (b.ranking.score || 0) - (a.ranking.score || 0));
  }
}

export const defaultContextRanker = new ContextRanker();
