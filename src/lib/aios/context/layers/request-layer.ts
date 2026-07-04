/**
 * StateAI AI Operating System (AIOS) — Request Context Layer (Priority 1)
 * 
 * Captures immediate user request, trace metadata, and execution parameters.
 * Highest priority layer — never truncated unless absolutely necessary.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class RequestLayer implements ContextLayer {
  readonly type = 'request';
  readonly priority = 1;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { context, query } = options;
    const timestamp = new Date();

    const item: ContextItem = {
      id: `ctx_req_${context.requestId}`,
      layer: 'request',
      content: {
        requestId: context.requestId,
        traceId: context.traceId,
        query: query || 'No direct query provided',
        state: context.state,
      },
      summary: `Active request ${context.requestId} (Trace: ${context.traceId}): ${query || ''}`,
      ranking: {
        relevance: 1.0,   // Immediate request is 100% relevant
        recency: 1.0,     // Occurred just now
        importance: 1.0,  // Critical priority
        confidence: 1.0,  // Deterministic system data
        tokenCost: Math.ceil((query || '').length / 4) + 20,
      },
      metadata: { ...context.metadata },
      timestamp,
      source: 'aios:kernel:request',
    };

    return [item];
  }

  validate(items: ContextItem[]): boolean {
    return items.every(item => item.layer === 'request' && item.content !== undefined);
  }
}
