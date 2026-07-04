/**
 * StateAI AI Operating System (AIOS) — Agents Interface Package
 * 
 * Defines the contract for multi-agent spawning and orchestration.
 */

import type { AIExecutionContext } from '../types';

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly goal: string;
}

export interface Agents {
  spawnAgent(agentType: string, goal: string, context: AIExecutionContext): Promise<string>;
  getAgentStatus(agentId: string): Promise<string>;
  terminateAgent(agentId: string): Promise<boolean>;
}
