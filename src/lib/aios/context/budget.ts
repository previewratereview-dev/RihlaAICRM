/**
 * StateAI AI Operating System (AIOS) — Context Budget & Compression Manager
 * 
 * Enforces strict token budgets across all 8 context layers.
 * Performs dynamic budget reallocation and applies configurable compression strategies
 * (Extractive, Abstractive, Keyword, Entity, Summary) before pruning overflow items.
 */

import type { ContextItem, ContextBudgetPlan, ContextBudgetAllocation, ContextLayerType, CompressionStrategyType } from './types';
import { ContextCompressor, defaultContextCompressor } from './compressor';

export interface BudgetOptimizationResult {
  readonly items: ContextItem[];
  readonly plan: ContextBudgetPlan;
  readonly removedCount: number;
  readonly compressedCount: number;
}

export class ContextBudgetManager {
  private defaultLayerPercentages: Record<ContextLayerType, number> = {
    request: 0.20,   // 20% - Current query & trace
    crm: 0.20,       // 20% - Active Lead / Booking records
    knowledge: 0.20, // 20% - RAG SOPs & guidelines
    memory: 0.15,    // 15% - Conversation history
    tool: 0.10,      // 10% - Tool schemas & recent outputs
    user: 0.05,      // 5%  - Profile & permissions
    tenant: 0.05,    // 5%  - SaaS feature gating
    prompt: 0.05,    // 5%  - System instructions
  };

  private compressor: ContextCompressor;

  constructor(compressor = defaultContextCompressor) {
    this.compressor = compressor;
  }

  /**
   * Optimize context items against the total token budget using compression & pruning.
   */
  optimizeContext(
    items: ContextItem[],
    maxTokens = 4096,
    customPercentages?: Partial<Record<ContextLayerType, number>>,
    strategy: CompressionStrategyType = 'summary',
    queryText = ''
  ): BudgetOptimizationResult {
    const percentages = { ...this.defaultLayerPercentages, ...customPercentages };
    
    // Initialize budget allocations per layer
    const allocations: Record<ContextLayerType, ContextBudgetAllocation> = {
      request: { layer: 'request', maxTokens: Math.floor(maxTokens * percentages.request), allocatedTokens: 0, usedTokens: 0, truncated: false },
      user: { layer: 'user', maxTokens: Math.floor(maxTokens * percentages.user), allocatedTokens: 0, usedTokens: 0, truncated: false },
      tenant: { layer: 'tenant', maxTokens: Math.floor(maxTokens * percentages.tenant), allocatedTokens: 0, usedTokens: 0, truncated: false },
      crm: { layer: 'crm', maxTokens: Math.floor(maxTokens * percentages.crm), allocatedTokens: 0, usedTokens: 0, truncated: false },
      knowledge: { layer: 'knowledge', maxTokens: Math.floor(maxTokens * percentages.knowledge), allocatedTokens: 0, usedTokens: 0, truncated: false },
      memory: { layer: 'memory', maxTokens: Math.floor(maxTokens * percentages.memory), allocatedTokens: 0, usedTokens: 0, truncated: false },
      tool: { layer: 'tool', maxTokens: Math.floor(maxTokens * percentages.tool), allocatedTokens: 0, usedTokens: 0, truncated: false },
      prompt: { layer: 'prompt', maxTokens: Math.floor(maxTokens * percentages.prompt), allocatedTokens: 0, usedTokens: 0, truncated: false },
    };

    // Group items by layer and sort each layer descending by score
    const layerItems: Record<ContextLayerType, ContextItem[]> = {
      request: [], user: [], tenant: [], crm: [], knowledge: [], memory: [], tool: [], prompt: [],
    };

    for (const item of items) {
      if (layerItems[item.layer]) {
        layerItems[item.layer].push(item);
      }
    }

    const finalItems: ContextItem[] = [];
    let removedCount = 0;
    let compressedCount = 0;
    let totalUsedTokens = 0;

    // First pass: Allocate tokens strictly within layer quotas
    const overflowItems: ContextItem[] = [];

    for (const layer of Object.keys(layerItems) as ContextLayerType[]) {
      const alloc = allocations[layer];
      const sorted = layerItems[layer].sort((a, b) => (b.ranking.score || 0) - (a.ranking.score || 0));

      for (const item of sorted) {
        const cost = item.ranking.tokenCost || 50;

        if (alloc.usedTokens + cost <= alloc.maxTokens) {
          alloc.usedTokens += cost;
          alloc.allocatedTokens += cost;
          totalUsedTokens += cost;
          finalItems.push(item);
        } else {
          // Attempt compression before sending to overflow
          const compressed = this.compressor.compress(item, strategy, queryText);
          const compressedCost = compressed.ranking.tokenCost;

          if (alloc.usedTokens + compressedCost <= alloc.maxTokens) {
            alloc.usedTokens += compressedCost;
            alloc.allocatedTokens += compressedCost;
            totalUsedTokens += compressedCost;
            compressedCount++;
            finalItems.push(compressed);
          } else {
            alloc.truncated = true;
            overflowItems.push(item);
          }
        }
      }
    }

    // Second pass: Borrow unused capacity across layers for overflow items
    const remainingBudget = maxTokens - totalUsedTokens;
    if (remainingBudget > 0 && overflowItems.length > 0) {
      const sortedOverflow = overflowItems.sort((a, b) => (b.ranking.score || 0) - (a.ranking.score || 0));
      let borrowedUsed = 0;

      for (const item of sortedOverflow) {
        const cost = item.ranking.tokenCost || 50;
        if (borrowedUsed + cost <= remainingBudget) {
          borrowedUsed += cost;
          totalUsedTokens += cost;
          allocations[item.layer].usedTokens += cost;
          finalItems.push(item);
        } else {
          // Try compressing overflow item against remaining borrowed budget
          const compressed = this.compressor.compress(item, strategy, queryText);
          const compressedCost = compressed.ranking.tokenCost;
          if (borrowedUsed + compressedCost <= remainingBudget) {
            borrowedUsed += compressedCost;
            totalUsedTokens += compressedCost;
            allocations[item.layer].usedTokens += compressedCost;
            compressedCount++;
            finalItems.push(compressed);
          } else {
            removedCount++;
          }
        }
      }
    } else {
      removedCount += overflowItems.length;
    }

    // Sort final items by original priority or score for prompt assembly
    finalItems.sort((a, b) => (b.ranking.score || 0) - (a.ranking.score || 0));

    return {
      items: finalItems,
      plan: {
        totalBudgetTokens: maxTokens,
        allocations,
        remainingTokens: maxTokens - totalUsedTokens,
      },
      removedCount,
      compressedCount,
    };
  }
}

export const defaultContextBudgetManager = new ContextBudgetManager();
