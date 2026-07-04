/**
 * StateAI AI Operating System (AIOS) — Tool Registry & Discovery Engine
 * 
 * Centralized repository for registering, querying, discovering, and tracking
 * metrics for all versioned AIOS tools across industries and categories.
 */

import type { AIOSTool, ToolCategory, ToolDiscoveryQuery, ToolMetrics, ToolRiskLevel } from './types';
import { ProviderConfigurationError } from '../errors';

export class ToolRegistry {
  private tools: Map<string, AIOSTool> = new Map();
  private versionedTools: Map<string, AIOSTool> = new Map();
  private metrics: Map<string, ToolMetrics> = new Map();

  private riskWeights: Record<ToolRiskLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  /**
   * Register a tool in the registry.
   * Stores by ID (latest version) and by ID@versionTag.
   */
  registerTool(tool: AIOSTool): void {
    const id = tool.id.toLowerCase();
    const verStr = `${tool.version.major}.${tool.version.minor}.${tool.version.patch}`;
    const versionKey = `${id}@${tool.version.tag || verStr}`;

    this.tools.set(id, tool);
    this.versionedTools.set(versionKey, tool);

    if (!this.metrics.has(id)) {
      this.metrics.set(id, {
        toolId: id,
        invocationCount: 0,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
        averageLatencyMs: 0,
        successRate: 100,
        failureRate: 0,
        totalTokensUsed: 0,
        averageTokenUsage: 0,
        totalCostUsd: 0,
        averageCostUsd: 0,
      });
    }
  }

  /**
   * Retrieve a tool by ID and optional version tag.
   */
  getTool(id: string, versionTag?: string): AIOSTool | undefined {
    const cleanId = id.toLowerCase();
    if (versionTag) {
      return this.versionedTools.get(`${cleanId}@${versionTag}`);
    }
    return this.tools.get(cleanId);
  }

  /**
   * List all registered tools, optionally filtered by category.
   */
  listTools(category?: ToolCategory): AIOSTool[] {
    const all = Array.from(this.tools.values());
    if (!category) return all;
    return all.filter(t => t.category === category);
  }

  /**
   * Remove a registered tool.
   */
  removeTool(id: string, versionTag?: string): boolean {
    const cleanId = id.toLowerCase();
    if (versionTag) {
      const deleted = this.versionedTools.delete(`${cleanId}@${versionTag}`);
      // If the latest tool in `tools` matches this exact object, remove it too
      if (this.tools.get(cleanId) === undefined) {
        this.tools.delete(cleanId);
      }
      return deleted;
    }
    this.versionedTools.delete(cleanId);
    return this.tools.delete(cleanId);
  }

  /**
   * Intelligent Tool Discovery Engine.
   * Filters registered tools based on capability requirements, permissions, risk, and industry.
   */
  discoverTools(query: ToolDiscoveryQuery): AIOSTool[] {
    return Array.from(this.tools.values()).filter(tool => {
      if (query.category && tool.category !== query.category) return false;
      if (query.industry && tool.industry && tool.industry.toLowerCase() !== query.industry.toLowerCase()) return false;
      
      if (query.maxRiskLevel) {
        const toolRisk = this.riskWeights[tool.riskLevel];
        const maxRisk = this.riskWeights[query.maxRiskLevel];
        if (toolRisk > maxRisk) return false;
      }

      if (query.requiredPermissions && query.requiredPermissions.length > 0) {
        // Tool's required permissions must be a subset of query's allowed permissions
        const hasAllPerms = tool.requiredPermissions.every(p => query.requiredPermissions!.includes(p));
        if (!hasAllPerms) return false;
      }

      if (query.supportsStreaming !== undefined && tool.supportsStreaming !== query.supportsStreaming) return false;
      if (query.supportsDryRun !== undefined && tool.supportsDryRun !== query.supportsDryRun) return false;
      if (query.supportsUndo !== undefined && tool.supportsUndo !== query.supportsUndo) return false;
      if (query.supportsMCP !== undefined && tool.supportsMCP !== query.supportsMCP) return false;
      if (query.executionMode && tool.executionMode && tool.executionMode !== query.executionMode) return false;

      if (query.searchString) {
        const search = query.searchString.toLowerCase();
        const matchesName = tool.name.toLowerCase().includes(search);
        const matchesDesc = tool.description.toLowerCase().includes(search);
        const matchesId = tool.id.toLowerCase().includes(search);
        if (!matchesName && !matchesDesc && !matchesId) return false;
      }

      return true;
    });
  }

  /**
   * Retrieve performance metrics for a specific tool.
   */
  getMetrics(toolId: string): ToolMetrics | undefined {
    return this.metrics.get(toolId.toLowerCase());
  }

  /**
   * Record invocation metrics for a tool.
   */
  recordMetrics(toolId: string, latencyMs: number, success: boolean, tokensUsed = 0, costUsd = 0): void {
    const id = toolId.toLowerCase();
    const m = this.metrics.get(id);
    if (!m) return;

    m.invocationCount++;
    if (success) {
      m.successCount++;
    } else {
      m.failureCount++;
    }

    m.totalLatencyMs += latencyMs;
    m.averageLatencyMs = Math.round(m.totalLatencyMs / m.invocationCount);
    m.successRate = Math.round((m.successCount / m.invocationCount) * 100);
    m.failureRate = 100 - m.successRate;

    m.totalTokensUsed += tokensUsed;
    m.averageTokenUsage = Math.round(m.totalTokensUsed / m.invocationCount);
    m.totalCostUsd += costUsd;
    m.averageCostUsd = Number((m.totalCostUsd / m.invocationCount).toFixed(4));
  }
}

export const defaultToolRegistry = new ToolRegistry();
