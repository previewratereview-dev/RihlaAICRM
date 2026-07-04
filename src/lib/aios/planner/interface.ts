/**
 * StateAI AI Operating System (AIOS) — Planner Interface Package
 * 
 * Defines the contract for autonomous multi-step planning (Milestone 5+).
 */

import type { AIExecutionContext } from '../types';

export interface Planner {
  readonly id: string;
  readonly name: string;
  createPlan(goal: string, context: AIExecutionContext): Promise<unknown>;
  executePlan(planId: string, context: AIExecutionContext): Promise<unknown>;
}
