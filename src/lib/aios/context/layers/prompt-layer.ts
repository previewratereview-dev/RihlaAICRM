/**
 * StateAI AI Operating System (AIOS) — Prompt Context Layer (Priority 8)
 * 
 * Injects system instructions, AI persona definitions, output formatting rules,
 * and behavior guidelines. Lowest priority layer — acts as foundational background.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class PromptLayer implements ContextLayer {
  readonly type = 'prompt';
  readonly priority = 8;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { extraData } = options;
    const timestamp = new Date();
    const systemPrompt = (extraData?.systemPrompt as string) || 'You are StateAI, an intelligent enterprise CRM assistant.';

    const item: ContextItem = {
      id: 'ctx_pmt_system',
      layer: 'prompt',
      content: systemPrompt,
      summary: systemPrompt.substring(0, 80) + '...',
      ranking: {
        relevance: 0.7,
        recency: 0.5,
        importance: 0.7,
        confidence: 1.0,
        tokenCost: Math.ceil(systemPrompt.length / 4) + 10,
      },
      metadata: { promptType: 'system' },
      timestamp,
      source: 'aios:prompts:system',
    };

    return [item];
  }
}
