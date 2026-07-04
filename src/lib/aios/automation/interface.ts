/**
 * StateAI AI Operating System (AIOS) — Automation Interface Package
 * 
 * Defines the contract for background event-driven automations.
 */

import type { AIExecutionContext } from '../types';

export interface Automation {
  readonly id: string;
  readonly name: string;
  trigger(event: string, payload: Record<string, unknown>, context: AIExecutionContext): Promise<void>;
}
