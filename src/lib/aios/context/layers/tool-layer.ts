/**
 * StateAI AI Operating System (AIOS) — Tool Context Layer (Priority 7)
 * 
 * Injects available tool schemas discovered for the current user/tenant,
 * along with recent deterministic tool execution results.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class ToolLayer implements ContextLayer {
  readonly type = 'tool';
  readonly priority = 7;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { extraData } = options;
    const timestamp = new Date();
    const availableTools = (extraData?.availableTools as Array<{ id: string; name: string; description: string }>) || [];
    const toolResults = (extraData?.toolResults as Array<{ toolId: string; summary: string; data: unknown }>) || [];

    const items: ContextItem[] = [];

    // Add available tool summaries
    if (availableTools.length > 0) {
      const toolsSummary = availableTools.map(t => `${t.id}: ${t.description}`).join('\n');
      items.push({
        id: 'ctx_tol_schemas',
        layer: 'tool',
        content: availableTools,
        summary: `Available tools (${availableTools.length}): ${availableTools.map(t => t.id).join(', ')}`,
        ranking: {
          relevance: 0.75,
          recency: 0.8,
          importance: 0.8,
          confidence: 1.0,
          tokenCost: Math.ceil(toolsSummary.length / 4) + 20,
        },
        metadata: { count: availableTools.length },
        timestamp,
        source: 'aios:tools:registry',
      });
    }

    // Add recent tool execution results
    for (const res of toolResults) {
      items.push({
        id: `ctx_tol_res_${res.toolId}_${Date.now()}`,
        layer: 'tool',
        content: res.data,
        summary: `Tool Result [${res.toolId}]: ${res.summary}`,
        ranking: {
          relevance: 0.9,
          recency: 0.95,
          importance: 0.85,
          confidence: 1.0,
          tokenCost: Math.ceil(JSON.stringify(res.data).length / 4) + 15,
        },
        metadata: { toolId: res.toolId },
        timestamp,
        source: `aios:tools:executor:${res.toolId}`,
      });
    }

    return items;
  }
}
