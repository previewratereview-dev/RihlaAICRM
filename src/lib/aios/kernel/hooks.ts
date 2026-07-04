/**
 * StateAI AI Operating System (AIOS) — Execution Hooks
 * 
 * Lifecycle hooks allowing plugins and telemetry to attach custom middleware
 * without modifying core AIKernel or InferenceManager code.
 */

import type { AIExecutionContext, CompletionOptions, CompletionResponse, ToolCall } from '../types';

export interface ExecutionHooks {
  beforeExecution?(context: AIExecutionContext, options: CompletionOptions): void | Promise<void>;
  afterExecution?(context: AIExecutionContext, response: CompletionResponse): void | Promise<void>;
  beforeProvider?(context: AIExecutionContext, providerId: string, model: string): void | Promise<void>;
  afterProvider?(context: AIExecutionContext, providerId: string, model: string, latencyMs: number): void | Promise<void>;
  beforeTool?(context: AIExecutionContext, toolCall: ToolCall): void | Promise<void>;
  afterTool?(context: AIExecutionContext, toolCall: ToolCall, result: unknown): void | Promise<void>;
  beforePlanner?(context: AIExecutionContext, goal: string): void | Promise<void>;
  afterPlanner?(context: AIExecutionContext, goal: string, plan: unknown): void | Promise<void>;
}

export class HookManager implements ExecutionHooks {
  private hooks: ExecutionHooks[] = [];

  registerHooks(hooks: ExecutionHooks): () => void {
    this.hooks.push(hooks);
    return () => {
      const idx = this.hooks.indexOf(hooks);
      if (idx !== -1) this.hooks.splice(idx, 1);
    };
  }

  async beforeExecution(context: AIExecutionContext, options: CompletionOptions): Promise<void> {
    for (const h of this.hooks) { if (h.beforeExecution) await h.beforeExecution(context, options); }
  }

  async afterExecution(context: AIExecutionContext, response: CompletionResponse): Promise<void> {
    for (const h of this.hooks) { if (h.afterExecution) await h.afterExecution(context, response); }
  }

  async beforeProvider(context: AIExecutionContext, providerId: string, model: string): Promise<void> {
    for (const h of this.hooks) { if (h.beforeProvider) await h.beforeProvider(context, providerId, model); }
  }

  async afterProvider(context: AIExecutionContext, providerId: string, model: string, latencyMs: number): Promise<void> {
    for (const h of this.hooks) { if (h.afterProvider) await h.afterProvider(context, providerId, model, latencyMs); }
  }

  async beforeTool(context: AIExecutionContext, toolCall: ToolCall): Promise<void> {
    for (const h of this.hooks) { if (h.beforeTool) await h.beforeTool(context, toolCall); }
  }

  async afterTool(context: AIExecutionContext, toolCall: ToolCall, result: unknown): Promise<void> {
    for (const h of this.hooks) { if (h.afterTool) await h.afterTool(context, toolCall, result); }
  }

  async beforePlanner(context: AIExecutionContext, goal: string): Promise<void> {
    for (const h of this.hooks) { if (h.beforePlanner) await h.beforePlanner(context, goal); }
  }

  async afterPlanner(context: AIExecutionContext, goal: string, plan: unknown): Promise<void> {
    for (const h of this.hooks) { if (h.afterPlanner) await h.afterPlanner(context, goal, plan); }
  }
}

export const defaultHookManager = new HookManager();
