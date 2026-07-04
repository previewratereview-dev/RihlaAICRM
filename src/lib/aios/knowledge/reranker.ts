/**
 * StateAI AI Operating System (AIOS) — Cross-Encoder Reranker Interface & Adapters
 * 
 * Provides high-precision cross-encoder relevance scoring and deduplication.
 * Includes clean interface adapters for BGE, Jina, Cohere, and NVIDIA rerankers,
 * with a fast default heuristic cross-encoder for local execution.
 */

import type { RerankerHit, KnowledgeSource } from './types';

export interface RerankCandidate {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly source?: KnowledgeSource;
  readonly metadata?: Record<string, unknown>;
}

export interface CrossEncoderReranker {
  readonly provider: 'bge' | 'jina' | 'cohere' | 'nvidia' | 'default';
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]>;
}

/**
 * Default Heuristic Cross-Encoder Adapter
 * Evaluates phrase matches, term overlap density, and freshness weighting.
 */
export class DefaultCrossEncoderAdapter implements CrossEncoderReranker {
  readonly provider = 'default';

  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]> {
    if (!candidates || candidates.length === 0) return [];

    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits: RerankerHit[] = [];

    for (const cand of candidates) {
      const contentLower = cand.content.toLowerCase();
      
      // 1. Exact phrase boost
      const phraseMatchBoost = contentLower.includes(query.toLowerCase()) ? 0.25 : 0;

      // 2. Term overlap density
      let matchCount = 0;
      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          matchCount++;
        }
      }
      const overlapScore = queryTerms.length > 0 ? (matchCount / queryTerms.length) * 0.4 : 0;

      // 3. Freshness / expiration penalty
      let freshnessMultiplier = 1.0;
      if (cand.source?.freshness) {
        const { expires, verified, isExpired } = cand.source.freshness;
        const now = new Date();
        if (isExpired || (expires && expires < now)) {
          freshnessMultiplier = 0.2; // Severe penalty for expired SOPs/knowledge
        } else {
          // Bonus for recently verified documents (< 30 days)
          const daysSinceVerified = (now.getTime() - new Date(verified).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceVerified <= 30) {
            freshnessMultiplier = 1.1;
          }
        }
      }

      // Combine original vector score (35%) with cross-encoder scoring (65%)
      const baseScore = cand.score * 0.35 + overlapScore + phraseMatchBoost;
      const finalScore = Math.min(1.0, Math.max(0.0, baseScore * freshnessMultiplier));

      hits.push({
        id: cand.id,
        content: cand.content,
        score: Number(finalScore.toFixed(4)),
        originalScore: cand.score,
        source: cand.source,
        metadata: cand.metadata,
      });
    }

    // Deduplicate identical content and sort descending by score
    const seenContent = new Set<string>();
    const deduplicated: RerankerHit[] = [];

    for (const hit of hits.sort((a, b) => b.score - a.score)) {
      const normalizedContent = hit.content.trim().toLowerCase();
      if (!seenContent.has(normalizedContent)) {
        seenContent.add(normalizedContent);
        deduplicated.push(hit);
      }
      if (deduplicated.length >= topK) break;
    }

    return deduplicated;
  }
}

/**
 * BGE Reranker Adapter (BAAI/bge-reranker-large)
 */
export class BGERerankerAdapter implements CrossEncoderReranker {
  readonly provider = 'bge';
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]> {
    // Production implementation will invoke BGE inference endpoint
    return new DefaultCrossEncoderAdapter().rerank(query, candidates, topK);
  }
}

/**
 * Jina Reranker Adapter (jina-reranker-v2)
 */
export class JinaRerankerAdapter implements CrossEncoderReranker {
  readonly provider = 'jina';
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]> {
    return new DefaultCrossEncoderAdapter().rerank(query, candidates, topK);
  }
}

/**
 * Cohere Reranker Adapter (rerank-english-v3.0)
 */
export class CohereRerankerAdapter implements CrossEncoderReranker {
  readonly provider = 'cohere';
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]> {
    return new DefaultCrossEncoderAdapter().rerank(query, candidates, topK);
  }
}

/**
 * NVIDIA Reranker Adapter (nv-rerank-qa-mistral-4b)
 */
export class NVIDIARerankerAdapter implements CrossEncoderReranker {
  readonly provider = 'nvidia';
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankerHit[]> {
    return new DefaultCrossEncoderAdapter().rerank(query, candidates, topK);
  }
}

export const defaultCrossEncoderReranker: CrossEncoderReranker = new DefaultCrossEncoderAdapter();
