/**
 * StateAI AI Operating System (AIOS) — Core Type Definitions
 * 
 * Vendor-neutral TypeScript interfaces for LLM providers, completions,
 * tool calling, embeddings, streaming, model metadata, and health monitoring.
 * 
 * STRICT RULE: No OpenAI SDK or Anthropic SDK types are permitted here.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // Standard JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  estimatedCost?: number;
}

export interface CompletionOptions {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  jsonMode?: boolean;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface CompletionResponse {
  text: string;
  toolCalls?: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  provider: string;
  model: string;
  rawResponse?: unknown;
}

export interface StreamingChunk {
  textDelta?: string;
  toolCallDelta?: {
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  finishReason?: FinishReason;
  usage?: Usage;
  provider: string;
  model: string;
}

export interface EmbeddingOptions {
  model: string;
  input: string | string[];
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage: {
    tokensIn: number;
    totalTokens: number;
  };
  provider: string;
  model: string;
}

export interface CostMetadata {
  promptPer1k: number;
  completionPer1k: number;
  currency: string;
}

export interface SpeedMetadata {
  averageTokensPerSecond?: number;
  averageLatencyMs?: number;
  tier: 'fast' | 'balanced' | 'reasoning' | 'heavy';
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsJson: boolean;
  supportsEmbeddings: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  costMetadata: CostMetadata;
  speedMetadata: SpeedMetadata;
  reasoningScore: number; // 1-10 scale
  capabilityFlags: string[];
}

export interface ProviderCapabilities {
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsJsonMode: boolean;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportedModels: string[];
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  lastSuccessfulRequest?: Date;
  lastFailure?: Date;
  lastErrorMessage?: string;
  availabilityPercentage: number;
  modelAvailability: Record<string, boolean>;
}

export interface ProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly rawError?: unknown;
}

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  
  complete(options: CompletionOptions): Promise<CompletionResponse>;
  stream(options: CompletionOptions): AsyncIterable<StreamingChunk>;
  embed(options: EmbeddingOptions): Promise<EmbeddingResponse>;
  
  getCapabilities(): ProviderCapabilities;
  healthCheck(): Promise<ProviderHealth>;
  getHealth(): ProviderHealth;
}

export type ExecutionState =
  | 'created'
  | 'queued'
  | 'planning'
  | 'executing'
  | 'waiting_hitl'
  | 'retrying'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface AIExecutionContext {
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly traceId: string;
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly startTime: Date;
  state: ExecutionState;
  readonly stateHistory: Array<{ state: ExecutionState; timestamp: Date; reason?: string }>;
  readonly features: {
    planner?: boolean;
    memory?: boolean;
    workflow?: boolean;
    vision?: boolean;
    voice?: boolean;
    automation?: boolean;
    [key: string]: boolean | undefined;
  };
  readonly permissions: string[];
  readonly metadata: Record<string, unknown>;
}


