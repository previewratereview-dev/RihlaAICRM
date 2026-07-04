/**
 * StateAI AI Operating System (AIOS) — Context Engine
 * 
 * Authoritative cognitive engine governing:
 * - Layered Context Assembly (8 layers: request, user, tenant, crm, knowledge, memory, tool, prompt)
 * - Multi-Dimensional Ranking (configurable per-tenant weights)
 * - Token Budgeting & Reallocation
 * - 5-Strategy Context Compression (Extractive, Abstractive, Keyword, Entity, Summary)
 * - Knowledge Retrieval requests (delegated cleanly to Knowledge Engine)
 * - Context Caching (high-speed caching for repeated queries)
 * - Runtime Variables reservation ({{today}}, {{timezone}}, {{currency}}, etc.)
 */

import type { ContextLayer, ContextItem, ContextBuildOptions, RuntimeContextState, ContextLayerType } from './types';
import { ContextRanker, defaultContextRanker } from './ranking';
import { ContextBudgetManager, defaultContextBudgetManager } from './budget';
import { EntityExtractor, defaultEntityExtractor } from './extractor';
import { defaultEventBus, type EventBus } from '../events';
import {
  RequestLayer,
  UserLayer,
  TenantLayer,
  CRMLayer,
  KnowledgeLayer,
  MemoryLayer,
  ToolLayer,
  PromptLayer,
} from './layers';

export interface ContextCacheEntry {
  readonly state: RuntimeContextState;
  readonly expiresAt: number;
}

export class ContextEngine {
  private layers: Map<ContextLayerType, ContextLayer> = new Map();
  private ranker: ContextRanker;
  private budgetManager: ContextBudgetManager;
  private extractor: EntityExtractor;
  private eventBus: EventBus;
  private cache: Map<string, ContextCacheEntry> = new Map();
  private defaultCacheTTLMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    ranker = defaultContextRanker,
    budgetManager = defaultContextBudgetManager,
    extractor = defaultEntityExtractor,
    eventBus = defaultEventBus
  ) {
    this.ranker = ranker;
    this.budgetManager = budgetManager;
    this.extractor = extractor;
    this.eventBus = eventBus;

    this.registerDefaultLayers();
  }

  private registerDefaultLayers(): void {
    this.registerLayer(new RequestLayer());
    this.registerLayer(new UserLayer());
    this.registerLayer(new TenantLayer());
    this.registerLayer(new CRMLayer());
    this.registerLayer(new KnowledgeLayer());
    this.registerLayer(new MemoryLayer());
    this.registerLayer(new ToolLayer());
    this.registerLayer(new PromptLayer());
  }

  /**
   * Register or override a specific context layer.
   */
  registerLayer(layer: ContextLayer): void {
    this.layers.set(layer.type, layer);
  }

  /**
   * Get a registered context layer by type.
   */
  getLayer(type: ContextLayerType): ContextLayer | undefined {
    return this.layers.get(type);
  }

  /**
   * Build an optimized, token-budgeted runtime context state across all registered layers.
   */
  async buildContext(options: ContextBuildOptions): Promise<RuntimeContextState> {
    const { context, query = '', maxTokens = 4096, rankingWeights, compressionStrategy = 'summary', useCache = false } = options;

    // Check Context Cache if enabled
    const cacheKey = `${context.tenantId}:${context.userId}:${query}:${maxTokens}:${compressionStrategy}`;
    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        await this.eventBus.publish('context.cache_hit', { cacheKey, traceId: context.traceId }, context);
        return { ...cached.state, cached: true };
      }
    }

    const rawItems: ContextItem[] = [];

    // Step 1: Execute all layer builders sorted by priority ascending (1 = highest)
    const sortedLayers = Array.from(this.layers.values()).sort((a, b) => a.priority - b.priority);

    for (const layer of sortedLayers) {
      try {
        const layerItems = await layer.build(options);
        
        if (layer.validate && !layer.validate(layerItems)) {
          throw new Error(`Validation failed for context layer '${layer.type}'`);
        }

        rawItems.push(...layerItems);
      } catch (err) {
        await this.eventBus.publish('context.layer_failed', {
          layer: layer.type,
          error: err instanceof Error ? err.message : String(err),
        }, context);
      }
    }

    // Step 2: Extract entities from textual context items
    for (const item of rawItems) {
      if (typeof item.content === 'string') {
        await this.extractor.extractFromText(item.content, `layer:${item.layer}`, context.traceId);
      }
    }
    const extractedEntities = this.extractor.getEntities(context.traceId);

    // Step 3: Compute multi-dimensional ranking scores (with per-tenant weights if provided)
    const rankedItems = this.ranker.rank(rawItems, query, rankingWeights);

    // Step 4: Optimize against token budget allocations using selected compression strategy
    const { items: activeItems, plan: budgetPlan } = this.budgetManager.optimizeContext(
      rankedItems,
      maxTokens,
      undefined,
      compressionStrategy,
      query
    );

    const totalTokensUsed = Object.values(budgetPlan.allocations).reduce((sum, a) => sum + a.usedTokens, 0);

    // Step 5: Reserve and compute runtime variables
    const runtimeVariables: Record<string, string> = {
      '{{today}}': new Date().toISOString().split('T')[0],
      '{{timezone}}': Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      '{{currency}}': 'USD', // Default or tenant preference
      '{{agency}}': context.tenantId || 'StateAI',
      '{{loggedInUser}}': context.userId || 'System',
      '{{subscription}}': 'Enterprise',
    };

    const runtimeState: RuntimeContextState = {
      activeItems,
      budgetPlan,
      extractedEntities,
      runtimeVariables,
      totalTokensUsed,
      timestamp: new Date(),
      traceId: context.traceId,
      cached: false,
    };

    // Store in Context Cache
    if (useCache) {
      this.cache.set(cacheKey, {
        state: runtimeState,
        expiresAt: Date.now() + this.defaultCacheTTLMs,
      });
    }

    // Step 6: Publish context built event
    await this.eventBus.publish('context.built', {
      traceId: context.traceId,
      totalItems: activeItems.length,
      totalTokensUsed,
      entityCount: extractedEntities.length,
      compressionStrategy,
    }, context);

    return runtimeState;
  }
}

export const defaultContextEngine = new ContextEngine();
