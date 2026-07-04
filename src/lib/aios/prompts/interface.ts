/**
 * StateAI AI Operating System (AIOS) — Prompts Interface Package
 * 
 * Defines the contract for prompt template management, rendering, and versioning.
 */

export interface PromptVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
  readonly hash?: string;
}

export interface VersionedPromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly template: string;
  readonly version: PromptVersion;
  readonly variables: string[];
}

export interface PromptManager {
  getPromptTemplate(templateId: string, versionTag?: string): Promise<VersionedPromptTemplate>;
  renderPrompt(templateId: string, variables: Record<string, unknown>, versionTag?: string): Promise<string>;
  registerPrompt(template: VersionedPromptTemplate): void;
}
