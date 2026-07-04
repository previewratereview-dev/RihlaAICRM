/**
 * StateAI AI Operating System (AIOS) — Workflow Interface Package
 * 
 * Defines the contract for deterministic and agentic workflows (Milestone 6+).
 */

import type { AIExecutionContext } from '../types';

export interface WorkflowVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly version: WorkflowVersion;
  execute(input: Record<string, unknown>, context: AIExecutionContext): Promise<Record<string, unknown>>;
  getStatus(executionId: string): Promise<string>;
}
