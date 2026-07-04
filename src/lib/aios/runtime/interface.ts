/**
 * StateAI AI Operating System (AIOS) — Agent Runtime Namespace
 * 
 * Reserved namespace for future agent execution runtime (Milestones 4-6).
 * Houses contracts for Session, Context, Scratchpad, Execution Graph, Variables, and Temporary Memory.
 * 
 * STRICT RULE: Reserved namespace. Do not implement concrete execution graphs here until future milestones.
 */

import type { AIExecutionContext } from '../types';

export interface RuntimeSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly activeContext: AIExecutionContext;
}

export interface RuntimeScratchpad {
  readonly sessionId: string;
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  clear(): void;
}

export interface ExecutionGraphNode {
  readonly id: string;
  readonly type: 'tool' | 'llm' | 'condition' | 'subagent';
  readonly dependencies: string[];
}

export interface ExecutionGraph {
  readonly graphId: string;
  readonly nodes: ExecutionGraphNode[];
  execute(session: RuntimeSession): Promise<Record<string, unknown>>;
}

export interface TemporaryMemory {
  readonly sessionId: string;
  put(key: string, value: unknown, ttlSeconds?: number): void;
  get(key: string): unknown;
}
