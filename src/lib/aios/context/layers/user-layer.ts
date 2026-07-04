/**
 * StateAI AI Operating System (AIOS) — User Context Layer (Priority 2)
 * 
 * Injects user profile identity, preferences, assigned roles, and permission boundaries.
 */

import type { ContextLayer, ContextItem, ContextBuildOptions } from '../types';

export class UserLayer implements ContextLayer {
  readonly type = 'user';
  readonly priority = 2;

  async build(options: ContextBuildOptions): Promise<ContextItem[]> {
    const { context, extraData } = options;
    const timestamp = new Date();
    const userProfile = extraData?.userProfile || { role: 'agent', preferences: {} };

    const item: ContextItem = {
      id: `ctx_usr_${context.userId}`,
      layer: 'user',
      content: {
        userId: context.userId,
        permissions: context.permissions,
        ...userProfile,
      },
      summary: `User ${context.userId} with permissions: [${context.permissions.join(', ')}]`,
      ranking: {
        relevance: 0.9,
        recency: 0.9,
        importance: 0.9,
        confidence: 1.0,
        tokenCost: 35,
      },
      metadata: { userId: context.userId },
      timestamp,
      source: 'aios:auth:user',
    };

    return [item];
  }
}
