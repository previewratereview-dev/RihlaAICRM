/**
 * StateAI AI Operating System (AIOS) — Context Platform Types
 * 
 * Enterprise contracts for layered context building, ranking, budgeting,
 * entity extraction, compression strategies, runtime variables, and state management.
 */

import type { AIExecutionContext } from '../types';
import type { TrustScore } from '../knowledge/types';

export type ContextLayerType =
  | 'request'
  | 'user'
  | 'tenant'
  | 'crm'
  | 'knowledge'
  | 'memory'
  | 'tool'
  | 'prompt';

export interface ContextItemRanking {
  relevance: number;  // 0 to 1 (semantic similarity or direct query match)
  recency: number;    // 0 to 1 (time decay based on timestamp)
  importance: number; // 0 to 1 (architectural or business criticality)
  confidence: number; // 0 to 1 (verification accuracy of source)
  tokenCost: number;  // estimated token consumption of this item
  score?: number;     // composite weighted score computed by ContextRanker
}

export interface TenantRankingWeights {
  readonly relevance: number;
  readonly recency: number;
  readonly importance: number;
  readonly confidence: number;
}

export type CompressionStrategyType =
  | 'extractive'
  | 'abstractive'
  | 'keyword'
  | 'entity'
  | 'summary';

export interface ContextItem<T = unknown> {
  readonly id: string;
  readonly citationId?: string;
  readonly layer: ContextLayerType;
  readonly content: T;
  readonly summary?: string;
  readonly ranking: ContextItemRanking;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
  readonly source?: string;
  readonly uri?: string;
  readonly version?: string;
  readonly trust?: TrustScore;
}

export interface ContextBuildOptions {
  readonly context: AIExecutionContext;
  readonly query?: string;
  readonly maxTokens?: number;
  readonly filters?: Record<string, unknown>;
  readonly extraData?: Record<string, unknown>;
  readonly rankingWeights?: TenantRankingWeights;
  readonly compressionStrategy?: CompressionStrategyType;
  readonly useCache?: boolean;
}

export interface ContextLayer {
  readonly type: ContextLayerType;
  readonly priority: number; // 1 (highest priority e.g., request) to 8 (lowest e.g., prompt defaults)
  build(options: ContextBuildOptions): Promise<ContextItem[]>;
  validate?(items: ContextItem[]): boolean;
}

export interface ContextBudgetAllocation {
  readonly layer: ContextLayerType;
  readonly maxTokens: number;
  allocatedTokens: number;
  usedTokens: number;
  truncated: boolean;
}

export interface ContextBudgetPlan {
  readonly totalBudgetTokens: number;
  readonly allocations: Record<ContextLayerType, ContextBudgetAllocation>;
  remainingTokens: number;
}

export type ExtractedEntityType =
  | 'customer'
  | 'hotel'
  | 'booking'
  | 'destination'
  | 'company'
  | 'invoice'
  | 'employee'
  | 'other';

export interface ExtractedEntity {
  readonly id: string;
  readonly type: ExtractedEntityType;
  readonly value: string;
  readonly confidence: number;
  readonly source: string;
  readonly timestamp: Date;
  readonly attributes: Record<string, unknown>;
}

export interface RuntimeContextState {
  readonly activeItems: ContextItem[];
  readonly budgetPlan: ContextBudgetPlan;
  readonly extractedEntities: ExtractedEntity[];
  readonly runtimeVariables: Record<string, string>;
  readonly totalTokensUsed: number;
  readonly timestamp: Date;
  readonly traceId: string;
  readonly cached?: boolean;
}
