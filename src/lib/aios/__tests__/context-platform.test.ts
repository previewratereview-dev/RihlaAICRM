import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextEngine,
  ContextRanker,
  ContextBudgetManager,
  ContextCompressor,
  EntityExtractor,
  InMemoryVectorAdapter,
  RetrievalPipeline,
  QueryRewriter,
  MultiQueryRetriever,
  DefaultCrossEncoderAdapter,
} from '../index';
import type { AIExecutionContext } from '../types';

describe('Milestone 3A — Context Engine & Knowledge Engine Architecture', () => {
  let engine: ContextEngine;
  let ranker: ContextRanker;
  let budgetManager: ContextBudgetManager;
  let compressor: ContextCompressor;
  let extractor: EntityExtractor;
  let vectorStore: InMemoryVectorAdapter;
  let rewriter: QueryRewriter;
  let multiQuery: MultiQueryRetriever;
  let reranker: DefaultCrossEncoderAdapter;
  let retrievalPipeline: RetrievalPipeline;
  let mockContext: AIExecutionContext;

  beforeEach(() => {
    ranker = new ContextRanker();
    compressor = new ContextCompressor();
    budgetManager = new ContextBudgetManager(compressor);
    extractor = new EntityExtractor();
    engine = new ContextEngine(ranker, budgetManager, extractor);
    
    vectorStore = new InMemoryVectorAdapter();
    rewriter = new QueryRewriter();
    multiQuery = new MultiQueryRetriever();
    reranker = new DefaultCrossEncoderAdapter();
    retrievalPipeline = new RetrievalPipeline(vectorStore, rewriter, multiQuery, reranker);

    mockContext = {
      requestId: 'req_ctx_101',
      tenantId: 'tenant_travel_inc',
      userId: 'user_agent_007',
      traceId: 'trace_ctx_engine',
      provider: 'openai',
      model: 'gpt-4o',
      cost: 0,
      startTime: new Date(),
      state: 'executing',
      stateHistory: [],
      features: { planner: true, memory: true, workflow: true, vision: false, automation: true },
      permissions: ['leads:read', 'leads:write', 'travel:book'],
      metadata: { department: 'VIP Concierge' },
    };
  });

  describe('1. Layered Context Engine & Runtime Variables', () => {
    it('should execute all 8 registered layers and inject runtime variables ({{today}}, {{timezone}}, etc.)', async () => {
      const state = await engine.buildContext({
        context: mockContext,
        query: 'Book hotel in Dubai for Acme Corp contact@acme.com booking #BOOK-7788',
        maxTokens: 4096,
        extraData: {
          userProfile: { role: 'Senior Concierge', preferences: { currency: 'USD' } },
          crmRecords: [{ id: 'lead_555', name: 'Acme Corp', status: 'VIP' }],
          knowledgeHits: [{ id: 'sop_1', content: 'VIP clients receive complimentary airport transfer.', score: 0.95 }],
          memories: [{ id: 'mem_1', content: 'Client prefers high floor rooms.', type: 'semantic' }],
          availableTools: [{ id: 'travel.book_hotel', name: 'Book Hotel', description: 'Reserve hotel rooms' }],
          systemPrompt: 'You are StateAI Concierge.',
        },
      });

      expect(state.activeItems.length).toBeGreaterThanOrEqual(8);
      expect(state.runtimeVariables['{{today}}']).toBeDefined();
      expect(state.runtimeVariables['{{timezone}}']).toBeDefined();
      expect(state.runtimeVariables['{{currency}}']).toBe('USD');
      expect(state.runtimeVariables['{{agency}}']).toBe('tenant_travel_inc');
    });

    it('should cache assembled context state and return cache hit on identical subsequent queries', async () => {
      const options = {
        context: mockContext,
        query: 'What is the refund policy?',
        maxTokens: 2048,
        useCache: true,
      };

      const state1 = await engine.buildContext(options);
      expect(state1.cached).toBe(false);

      const state2 = await engine.buildContext(options);
      expect(state2.cached).toBe(true);
      expect(state2.activeItems).toHaveLength(state1.activeItems.length);
    });
  });

  describe('2. Configurable Context Ranking Engine', () => {
    it('should compute weighted scores with default or custom per-tenant weights', () => {
      const items = [
        {
          id: 'high_rel_low_conf',
          layer: 'knowledge' as const,
          content: 'SOP draft about booking procedure',
          ranking: { relevance: 0.9, recency: 0.5, importance: 0.5, confidence: 0.2, tokenCost: 10 },
          metadata: {},
          timestamp: new Date(),
        },
        {
          id: 'low_rel_high_conf',
          layer: 'crm' as const,
          content: 'Verified customer record',
          ranking: { relevance: 0.4, recency: 0.5, importance: 0.5, confidence: 1.0, tokenCost: 20 },
          metadata: {},
          timestamp: new Date(),
        },
      ];

      const rankedDefault = ranker.rank(items, 'booking procedure');
      expect(rankedDefault[0].id).toBe('high_rel_low_conf'); // Relevance (35%) outweighs confidence (15%)

      // Custom Compliance/Financial CRM weights prioritizing Confidence (70%) over Relevance (10%)
      const rankedCompliance = ranker.rank(items, 'booking procedure', {
        relevance: 0.10,
        recency: 0.10,
        importance: 0.10,
        confidence: 0.70,
      });
      expect(rankedCompliance[0].id).toBe('low_rel_high_conf'); // Confidence weight reversed ranking order!
    });
  });

  describe('3. Context Budget Manager & 5 Compression Strategies', () => {
    it('should apply Extractive, Abstractive, Keyword, Entity, and Summary compression strategies', () => {
      const text = `Please book a luxury room at Grand Palace Hotel for Acme Corp contact sarah@acme.com regarding booking #BOOK-9988 and invoice #INV-2026. This is a very important VIP client who always requires airport transfer and late check-out.`;
      const item = {
        id: 'long_item',
        layer: 'crm' as const,
        content: text,
        summary: 'VIP booking for Acme Corp',
        ranking: { relevance: 0.8, recency: 0.8, importance: 0.8, confidence: 1.0, tokenCost: 200 },
        metadata: {},
        timestamp: new Date(),
      };

      const extractive = compressor.compress(item, 'extractive', 'Grand Palace');
      expect(extractive.content).toContain('[EXTRACTIVE]');
      expect(extractive.content).toContain('Grand Palace');

      const abstractive = compressor.compress(item, 'abstractive');
      expect(abstractive.content).toContain('[ABSTRACTIVE BULLET]');

      const keyword = compressor.compress(item, 'keyword');
      expect(keyword.content).toContain('[KEYWORD DENSE]');

      const entity = compressor.compress(item, 'entity');
      expect(entity.content).toContain('[ENTITY ONLY]');
      expect(entity.content).toContain('sarah@acme.com');
    });
  });

  describe('4. Knowledge Engine — Query Rewriting & Multi-Query Generation', () => {
    it('should rewrite natural queries and extract structured metadata filters', async () => {
      const res = await rewriter.rewrite('show active vip customers from London regarding flight booking');
      
      expect(res.filters.city).toBe('london');
      expect(res.filters.status).toBe('vip');
      expect((res.filters.entityTypes as string[])).toContain('customer');
      expect((res.filters.entityTypes as string[])).toContain('booking');
      expect(res.keywords.length).toBeGreaterThan(0);
    });

    it('should generate 5 query variations (Original, Synonym, Semantic, Keyword, Abbreviation)', async () => {
      const variations = await multiQuery.generateVariations('show VIP SOP for customer hotel booking');
      
      expect(variations.length).toBeGreaterThanOrEqual(4);
      expect(variations.some(v => v.type === 'original')).toBe(true);
      expect(variations.some(v => v.type === 'synonym')).toBe(true);
      expect(variations.some(v => v.type === 'abbreviation')).toBe(true);
    });
  });

  describe('5. Knowledge Engine — Cross-Encoder Re-ranking & Freshness Governance', () => {
    it('should rerank hits and penalize expired knowledge sources', async () => {
      const candidates = [
        {
          id: 'sop_expired',
          content: 'Old procedure for hotel upgrade',
          score: 0.85,
          source: {
            id: 'sop_old',
            uri: 'sop://old',
            title: 'Old SOP',
            content: 'Old procedure for hotel upgrade',
            source: 'sharepoint',
            confidence: 0.9,
            version: 'v1.0',
            freshness: {
              created: new Date('2020-01-01'),
              updated: new Date('2021-01-01'),
              expires: new Date('2022-01-01'), // Expired!
              verified: new Date('2021-01-01'),
              isExpired: true,
            },
            metadata: {},
          },
        },
        {
          id: 'sop_fresh',
          content: 'New procedure for hotel upgrade',
          score: 0.80,
          source: {
            id: 'sop_new',
            uri: 'sop://new',
            title: 'New SOP',
            content: 'New procedure for hotel upgrade',
            source: 'sharepoint',
            confidence: 0.95,
            version: 'v2.0',
            freshness: {
              created: new Date(),
              updated: new Date(),
              verified: new Date(),
              isExpired: false,
            },
            metadata: {},
          },
        },
      ];

      const reranked = await reranker.rerank('hotel upgrade procedure', candidates, 5);
      expect(reranked[0].id).toBe('sop_fresh'); // Fresh outranks expired despite lower initial score
      expect(reranked[1].id).toBe('sop_expired');
      expect(reranked[0].score).toBeGreaterThan(reranked[1].score);
    });
  });

  describe('6. Authoritative 6-Stage Knowledge Retrieval Pipeline', () => {
    it('should execute 6-stage RAG pipeline (rewrite -> multi-query -> candidate -> hybrid -> rerank -> compress)', async () => {
      const collection = 'kb_articles';
      await vectorStore.upsert(collection, [
        { id: 'kb_1', values: [1, 0, 0], content: 'VIP clients receive complimentary lounge access at Dubai airport.' },
        { id: 'kb_2', values: [0, 1, 0], content: 'Standard baggage allowance is 23kg per passenger.' },
      ]);

      const result = await retrievalPipeline.retrieveAndOptimize('VIP lounge Dubai', collection, mockContext, {
        topK: 5,
        maxTokens: 500,
      });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.totalTokensUsed).toBeGreaterThan(0);
      expect(result.stageAudits.length).toBeGreaterThanOrEqual(6);
      expect(result.stageAudits[0]).toContain('Stage 1 (Query Rewriting)');
      expect(result.stageAudits[1]).toContain('Stage 2 (Multi-Query Generation)');
      expect(result.stageAudits.some(a => a.includes('Stage 3 (Candidate Retrieval)'))).toBe(true);
      expect(result.stageAudits.some(a => a.includes('Stage 4 (Hybrid Search Fusion)'))).toBe(true);
      expect(result.stageAudits.some(a => a.includes('Stage 5 (Cross-Encoder Re-ranking)'))).toBe(true);
      expect(result.stageAudits.some(a => a.includes('Stage 6 (Context Compression)'))).toBe(true);
    });
  });
});
