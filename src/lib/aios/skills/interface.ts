/**
 * StateAI AI Operating System (AIOS) — Skills Interface Package
 * 
 * Defines the contract for reusable agent skills and skill versioning.
 */

import type { AIExecutionContext } from '../types';

export interface SkillVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
}

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly version: SkillVersion;
  readonly instructions: string;
  execute(params: Record<string, unknown>, context: AIExecutionContext): Promise<unknown>;
}

export interface Skills {
  registerSkill(skill: SkillDefinition): void;
  getSkill(name: string, versionTag?: string): SkillDefinition | undefined;
  executeSkill(name: string, params: Record<string, unknown>, context: AIExecutionContext): Promise<unknown>;
}
