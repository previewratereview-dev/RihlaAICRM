/**
 * StateAI AI Operating System (AIOS) — Tool Platform Types & Contracts
 * 
 * Comprehensive enterprise contracts for the AIOS Tool Platform:
 * Metadata, categories, risk levels, execution modes, dry-run, undo,
 * idempotency, result envelopes, metrics, and discovery queries.
 */

import { z } from 'zod';
import type { AIExecutionContext } from '../types';

export type ToolCategory =
  | 'crm'
  | 'communication'
  | 'calendar'
  | 'analytics'
  | 'automation'
  | 'knowledge'
  | 'billing'
  | 'system'
  | 'travel'
  | 'healthcare'
  | 'realestate'
  | 'general';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolExecutionMode = 'local' | 'remote' | 'serverless' | 'mcp' | 'http' | 'queue';

export interface ToolVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
  readonly deprecated?: boolean;
}

export interface MCPMetadata {
  readonly mcpId: string;
  readonly protocolVersion: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly requiresConfirmation?: boolean;
}

export interface DryRunResult {
  readonly recordsModified: number;
  readonly affectedIds: string[];
  readonly validationErrors: string[];
  readonly estimatedDurationMs: number;
  readonly summary: string;
}

export interface ToolResultEnvelope<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly summary: string;
  readonly warnings: string[];
  readonly errors: string[];
  readonly metrics: {
    readonly latencyMs: number;
    readonly tokensUsed?: number;
    readonly costUsd?: number;
  };
  readonly audit: {
    readonly toolId: string;
    readonly version: string;
    readonly traceId: string;
    readonly timestamp: Date;
    readonly idempotencyKey?: string;
    readonly dryRun?: boolean;
    readonly undone?: boolean;
  };
  readonly nextSuggestions: string[];
}

export interface ToolMetrics {
  readonly toolId: string;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  successRate: number;
  failureRate: number;
  totalTokensUsed: number;
  averageTokenUsage: number;
  totalCostUsd: number;
  averageCostUsd: number;
}

export interface ToolDiscoveryQuery {
  readonly category?: ToolCategory;
  readonly industry?: string;
  readonly maxRiskLevel?: ToolRiskLevel;
  readonly requiredPermissions?: string[];
  readonly supportsStreaming?: boolean;
  readonly supportsDryRun?: boolean;
  readonly supportsUndo?: boolean;
  readonly supportsMCP?: boolean;
  readonly executionMode?: ToolExecutionMode;
  readonly searchString?: string;
}

export interface ToolExecutionOptions {
  readonly dryRun?: boolean;
  readonly undo?: boolean;
  readonly previousResult?: ToolResultEnvelope<any>;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface AIOSTool<TInput = any, TOutput = any> {
  readonly id: string;
  readonly version: ToolVersion;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly industry?: string;
  readonly riskLevel: ToolRiskLevel;
  readonly requiredPermissions: string[];
  readonly estimatedCost: number;
  readonly estimatedLatency: number;
  readonly supportsStreaming: boolean;
  readonly supportsDryRun: boolean;
  readonly supportsBatch: boolean;
  readonly supportsUndo: boolean;
  readonly supportsMCP: boolean;
  readonly executionMode?: ToolExecutionMode;
  readonly mcp?: MCPMetadata;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema?: z.ZodType<TOutput>;

  execute(input: TInput, context: AIExecutionContext, options?: ToolExecutionOptions): Promise<ToolResultEnvelope<TOutput>>;
  dryRun?(input: TInput, context: AIExecutionContext): Promise<DryRunResult>;
  undo?(input: TInput, context: AIExecutionContext, previousResult: ToolResultEnvelope<TOutput>, idempotencyKey?: string): Promise<ToolResultEnvelope<any>>;
}
