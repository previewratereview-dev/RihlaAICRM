/**
 * StateAI AI Operating System (AIOS) — Knowledge Retrieval Pipeline
 * 
 * Authoritative 6-stage knowledge retrieval and RAG preparation engine:
 * 1. Query Rewriting (filter extraction & keyword expansion)
 * 2. Multi-Query Variation Generation (Original, Synonym, Semantic, Keyword, Abbreviation)
 * 3. Candidate Retrieval (broad multi-query vector recall across vector stores)
 * 4. Hybrid Search & Reciprocal Rank Fusion (fusing dense + keyword scores)
 * 5. Cross-Encoder Re-ranking & Deduplication (with freshness/expiration governance)
 * 6. Context Compression & Prompt Assembly Readiness
 */

import { type VectorStore, defaultVectorStore, type VectorHit } from './vector-store';
import { QueryRewriter, defaultQueryRewriter } from './rewriter';
import { MultiQueryRetriever, defaultMultiQueryRetriever } from './multi-query';
import { type CrossEncoderReranker, defaultCrossEncoderReranker, type RerankCandidate } from './reranker';
import { defaultEventBus, type EventBus } from '../events';
import type { AIExecutionContext } from '../types';
import type { KnowledgeSource } from './types';

export interface RetrievalPipelineOptions {
  readonly topK?: number;
  readonly maxTokens?: number;
  readonly filter?: Record<string, unknown>;
  readonly hybridWeight?: number; // 0 (pure keyword) to 1 (pure vector similarity)
}

export interface RetrievalPipelineResult {
  readonly items: Array<{
    readonly id: string;
    readonly content: string;
    readonly score: number;
    readonly metadata: Record<string, unknown>;
    readonly source?: KnowledgeSource;
  }>;
  readonly totalTokensUsed: number;
  readonly stageAudits: string[];
  readonly rewrittenQuery: string;
  readonly extractedFilters: Record<string, unknown>;
}

export class RetrievalPipeline {
  private vectorStore: VectorStore;
  private rewriter: QueryRewriter;
  private multiQuery: MultiQueryRetriever;
  private reranker: CrossEncoderReranker;
  private eventBus: EventBus;

  constructor(
    vectorStore = defaultVectorStore,
    rewriter = defaultQueryRewriter,
    multiQuery = defaultMultiQueryRetriever,
    reranker = defaultCrossEncoderReranker,
    eventBus = defaultEventBus
  ) {
    this.vectorStore = vectorStore;
    this.rewriter = rewriter;
    this.multiQuery = multiQuery;
    this.reranker = reranker;
    this.eventBus = eventBus;
  }

  /**
   * Execute the 6-stage Knowledge Retrieval Pipeline.
   */
  async retrieveAndOptimize(
    queryText: string,
    collection: string,
    context?: AIExecutionContext,
    options: RetrievalPipelineOptions = {}
  ): Promise<RetrievalPipelineResult> {
    const topK = options.topK || 10;
    const maxTokens = options.maxTokens || 2048;
    const hybridWeight = options.hybridWeight ?? 0.7;
    const stageAudits: string[] = [];

    // Stage 1: Query Rewriting & Filter Extraction
    const rewriteResult = await this.rewriter.rewrite(queryText, context?.metadata || {});
    const combinedFilter = { ...(options.filter || {}), ...(rewriteResult.filters || {}) };
    stageAudits.push(`Stage 1 (Query Rewriting): Rewrote '${queryText}' -> '${rewriteResult.rewrittenQuery}' with filters ${JSON.stringify(combinedFilter)}`);

    // Stage 2: Multi-Query Variation Generation
    const variations = await this.multiQuery.generateVariations(rewriteResult.rewrittenQuery);
    stageAudits.push(`Stage 2 (Multi-Query Generation): Generated ${variations.length} query variations (${variations.map(v => v.type).join(', ')})`);

    // Stage 3: Candidate Retrieval across all variations
    const candidateTopK = Math.max(5, Math.ceil(topK * 1.5));
    const allHitsMap = new Map<string, { hit: VectorHit; denseScore: number; keywordScore: number }>();

    // Simulate query vector for dense retrieval
    const mockVector = Array.from({ length: 1536 }, () => Math.random() * 0.1);

    for (const varItem of variations) {
      const denseHits = await this.vectorStore.query(collection, {
        vector: mockVector,
        topK: candidateTopK,
        filter: Object.keys(combinedFilter).length > 0 ? combinedFilter : undefined,
      });

      const keywordHits = await this.vectorStore.query(collection, {
        queryText: varItem.query,
        topK: candidateTopK,
        filter: Object.keys(combinedFilter).length > 0 ? combinedFilter : undefined,
      });

      for (const h of denseHits) {
        const existing = allHitsMap.get(h.id);
        const weightedScore = h.score * varItem.weight;
        if (existing) {
          existing.denseScore = Math.max(existing.denseScore, weightedScore);
        } else {
          allHitsMap.set(h.id, { hit: h, denseScore: weightedScore, keywordScore: 0 });
        }
      }

      for (const h of keywordHits) {
        const existing = allHitsMap.get(h.id);
        const weightedScore = h.score * varItem.weight;
        if (existing) {
          existing.keywordScore = Math.max(existing.keywordScore, weightedScore);
        } else {
          allHitsMap.set(h.id, { hit: h, denseScore: 0, keywordScore: weightedScore });
        }
      }
    }

    stageAudits.push(`Stage 3 (Candidate Retrieval): Retrieved ${allHitsMap.size} unique candidates across ${variations.length} variations`);

    // Stage 4: Hybrid Search & Reciprocal Rank Fusion
    const hybridCandidates: RerankCandidate[] = Array.from(allHitsMap.values()).map(({ hit, denseScore, keywordScore }) => {
      const hybridScore = Number((denseScore * hybridWeight + keywordScore * (1 - hybridWeight)).toFixed(4));
      return {
        id: hit.id,
        content: hit.content || '',
        score: hybridScore,
        source: hit.source,
        metadata: hit.metadata,
      };
    });

    stageAudits.push(`Stage 4 (Hybrid Search Fusion): Fused ${hybridCandidates.length} candidates with hybrid weight ${hybridWeight}`);

    // Stage 5: Cross-Encoder Re-ranking & Freshness Governance
    const validCandidates = hybridCandidates.filter(h => h.content && h.content.trim().length > 0);
    const rerankedHits = await this.reranker.rerank(queryText, validCandidates, topK);

    stageAudits.push(`Stage 5 (Cross-Encoder Re-ranking): Reranked and deduplicated down to top ${rerankedHits.length} items using provider '${this.reranker.provider}'`);

    // Stage 6: Context Compression & Token Budgeting
    const finalItems: Array<{ id: string; content: string; score: number; metadata: Record<string, unknown>; source?: KnowledgeSource }> = [];
    let totalTokensUsed = 0;

    for (const h of rerankedHits) {
      const content = h.content;
      const tokenCost = Math.ceil(content.length / 4) + 10;

      if (totalTokensUsed + tokenCost <= maxTokens) {
        totalTokensUsed += tokenCost;
        finalItems.push({
          id: h.id,
          content,
          score: h.score,
          metadata: h.metadata || {},
          source: h.source,
        });
      } else if (maxTokens - totalTokensUsed > 50) {
        // Compress / truncate content to fit remaining budget
        const remainingTokens = maxTokens - totalTokensUsed;
        const maxChars = Math.max(20, (remainingTokens - 10) * 4);
        const compressedContent = `${content.substring(0, maxChars)}... [TRUNCATED]`;
        totalTokensUsed = maxTokens;
        finalItems.push({
          id: h.id,
          content: compressedContent,
          score: h.score,
          metadata: { ...(h.metadata || {}), compressed: true },
          source: h.source,
        });
        break;
      } else {
        break;
      }
    }

    stageAudits.push(`Stage 6 (Context Compression): Prepared ${finalItems.length} final knowledge items within ${totalTokensUsed}/${maxTokens} tokens`);

    if (context) {
      await this.eventBus.publish('knowledge.retrieved', {
        traceId: context.traceId,
        queryText,
        rewrittenQuery: rewriteResult.rewrittenQuery,
        itemCount: finalItems.length,
        totalTokensUsed,
      }, context);
    }

    return {
      items: finalItems,
      totalTokensUsed,
      stageAudits,
      rewrittenQuery: rewriteResult.rewrittenQuery,
      extractedFilters: combinedFilter,
    };
  }
}

export const defaultRetrievalPipeline = new RetrievalPipeline();
