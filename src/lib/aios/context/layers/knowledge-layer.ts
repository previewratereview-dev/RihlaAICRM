/**
 * StateAI AI Operating System (AIOS) — Knowledge Context Layer (Priority 5)
 * 
 * Injects RAG-retrieved standard operating procedures, documentation,
 * vector search hits, and business guidelines by requesting them cleanly
 * from the standalone Knowledge Engine (`src/lib/aios/knowledge`).
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';
import { defaultRetrievalPipeline, type RetrievalPipeline } from '../../knowledge';

export class KnowledgeLayer implements ContextLayer {
  readonly type = 'knowledge';
  readonly priority = 5;
  private retrievalPipeline: RetrievalPipeline;

  constructor(retrievalPipeline = defaultRetrievalPipeline) {
    this.retrievalPipeline = retrievalPipeline;
  }

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { context, query, extraData } = options;
    const timestamp = new Date();
    const items: ContextItem[] = [];

    // 1. Fetch from extraData if manually provided (e.g., in unit tests or specific overrides)
    const manualHits = (extraData?.knowledgeHits as Array<{ id: string; content: string; score: number; summary?: string; source?: any }>) || [];
    for (const hit of manualHits) {
      items.push({
        id: `ctx_knw_${hit.id}`,
        layer: 'knowledge',
        content: hit.content,
        summary: hit.summary || hit.content.substring(0, 100) + '...',
        ranking: {
          relevance: hit.score || 0.75,
          recency: 0.7,
          importance: 0.8,
          confidence: hit.source?.confidence || 0.85,
          tokenCost: Math.ceil(hit.content.length / 4) + 10,
        },
        metadata: { hitId: hit.id, similarityScore: hit.score },
        timestamp,
        source: hit.source?.source || 'aios:knowledge:manual',
        uri: hit.source?.uri || `knowledge://${hit.id}`,
        version: hit.source?.version || 'v1.0',
      });
    }

    // 2. Request knowledge from Knowledge Engine retrieval pipeline if query is present
    if (query && items.length === 0) {
      try {
        const result = await this.retrievalPipeline.retrieveAndOptimize(query, 'default_collection', context, {
          topK: 5,
          filter: options.filters,
        });

        for (const hit of result.items) {
          items.push({
            id: `ctx_knw_pipe_${hit.id}`,
            layer: 'knowledge',
            content: hit.content,
            summary: hit.content.substring(0, 100) + '...',
            ranking: {
              relevance: hit.score,
              recency: 0.8,
              importance: 0.85,
              confidence: hit.source?.confidence || 0.9,
              tokenCost: Math.ceil(hit.content.length / 4) + 10,
            },
            metadata: { ...hit.metadata, hitId: hit.id, similarityScore: hit.score },
            timestamp: hit.source?.freshness?.updated || timestamp,
            source: hit.source?.source || 'aios:knowledge:pipeline',
            uri: hit.source?.uri || `knowledge://${hit.id}`,
            version: hit.source?.version || 'v1.0',
          });
        }
      } catch (err) {
        // Fall back gracefully if vector store query fails or is empty
      }
    }

    return items;
  }
}
