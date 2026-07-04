/**
 * StateAI AI Operating System (AIOS) — Memory Context Layer (Priority 6)
 * 
 * Injects active conversation history, short-term scratchpad notes,
 * and relevant episodic/working memories.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class MemoryLayer implements ContextLayer {
  readonly type = 'memory';
  readonly priority = 6;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { extraData } = options;
    const timestamp = new Date();
    const memories = (extraData?.memories as Array<{ id: string; content: string; type: string; confidence?: number }>) || [];

    return memories.map(mem => ({
      id: `ctx_mem_${mem.id}`,
      layer: 'memory',
      content: mem.content,
      summary: `[${mem.type.toUpperCase()}] ${mem.content.substring(0, 80)}`,
      ranking: {
        relevance: 0.8,
        recency: mem.type === 'scratchpad' ? 0.95 : 0.6,
        importance: mem.type === 'semantic' ? 0.85 : 0.7,
        confidence: mem.confidence ?? 0.8,
        tokenCost: Math.ceil(mem.content.length / 4) + 10,
      },
      metadata: { memoryType: mem.type },
      timestamp,
      source: `aios:memory:${mem.type}`,
    }));
  }
}
