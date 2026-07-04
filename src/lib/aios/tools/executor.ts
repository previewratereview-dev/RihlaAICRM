/**
 * StateAI AI Operating System (AIOS) — Tool Executor
 * 
 * Secure execution wrapper providing:
 * - Idempotency caching (preventing duplicate updates or emails on retries)
 * - Dry-Run execution branching (calculating affected records before mutation)
 * - Undo execution branching
 * - Timeout & Exponential Backoff Retries
 * - Zod Input/Output Validation & Permission Guard checks
 * - Standardized ToolResultEnvelope normalization
 * - Audit logging & EventBus emissions
 */

import type { AIExecutionContext } from '../types';
import type { AIOSTool, ToolExecutionOptions, ToolResultEnvelope } from './types';
import { defaultToolRegistry, type ToolRegistry } from './registry';
import { defaultToolValidator, type ToolValidator } from './validator';
import { defaultToolPermissionGuard, type ToolPermissionGuard } from './permissions';
import { defaultEventBus, type EventBus } from '../events';
import { withTimeout, withRetry } from '../utils';
import { ProviderConfigurationError } from '../errors';

export class ToolExecutor {
  private registry: ToolRegistry;
  private validator: ToolValidator;
  private permissionGuard: ToolPermissionGuard;
  private eventBus: EventBus;
  private idempotencyCache: Map<string, ToolResultEnvelope<any>> = new Map();

  constructor(
    registry: ToolRegistry = defaultToolRegistry,
    validator: ToolValidator = defaultToolValidator,
    permissionGuard: ToolPermissionGuard = defaultToolPermissionGuard,
    eventBus: EventBus = defaultEventBus
  ) {
    this.registry = registry;
    this.validator = validator;
    this.permissionGuard = permissionGuard;
    this.eventBus = eventBus;
  }

  /**
   * Execute a tool securely by ID.
   */
  async execute<TInput = any, TOutput = any>(
    toolId: string,
    input: unknown,
    context: AIExecutionContext,
    options?: ToolExecutionOptions
  ): Promise<ToolResultEnvelope<TOutput>> {
    const startTime = Date.now();
    const cleanId = toolId.toLowerCase();
    const tool = this.registry.getTool(cleanId);

    if (!tool) {
      throw new ProviderConfigurationError('tool', `Tool '${toolId}' not found in registry`);
    }

    const versionStr = `${tool.version.major}.${tool.version.minor}.${tool.version.patch}`;

    // Step 1: Idempotency Check
    if (options?.idempotencyKey) {
      const cached = this.idempotencyCache.get(options.idempotencyKey);
      if (cached) {
        return {
          ...cached,
          warnings: [...cached.warnings, `Idempotency hit: Returned cached result for key '${options.idempotencyKey}'`],
        } as ToolResultEnvelope<TOutput>;
      }
    }

    // Step 2: Permission Guard Check
    const permDecision = await this.permissionGuard.checkPermissions(tool, context);
    if (!permDecision.allowed) {
      const errEnvelope: ToolResultEnvelope<TOutput> = {
        success: false,
        summary: `Permission denied for tool '${tool.name}'`,
        warnings: [],
        errors: [permDecision.reason || 'Permission check failed'],
        metrics: { latencyMs: Date.now() - startTime },
        audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), idempotencyKey: options?.idempotencyKey },
        nextSuggestions: ['Check user role or request elevated permissions'],
      };
      await this.eventBus.publish('tool.failed', { toolId: cleanId, reason: permDecision.reason }, context);
      return errEnvelope;
    }

    if (permDecision.requiresHITL && !context.metadata?.autonomousApproved && !context.metadata?.hitlApproved) {
      context.state = 'waiting_hitl';
      const hitlEnvelope: ToolResultEnvelope<TOutput> = {
        success: false,
        summary: `Tool '${tool.name}' requires Human-In-The-Loop (HITL) confirmation`,
        warnings: [permDecision.reason || 'Action classified as high/critical risk or destructive'],
        errors: ['HITL approval required before execution'],
        metrics: { latencyMs: Date.now() - startTime },
        audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), idempotencyKey: options?.idempotencyKey },
        nextSuggestions: ['Request user confirmation via UI prompt before retrying with hitlApproved: true'],
      };
      await this.eventBus.publish('tool.failed', { toolId: cleanId, reason: 'HITL approval required' }, context);
      return hitlEnvelope;
    }

    // Step 3: Input Validation
    let validatedInput: TInput;
    try {
      validatedInput = this.validator.validateInput(tool, input);
    } catch (valErr: any) {
      const errEnvelope: ToolResultEnvelope<TOutput> = {
        success: false,
        summary: `Invalid arguments provided to tool '${tool.name}'`,
        warnings: [],
        errors: [valErr.message || 'Zod validation failed'],
        metrics: { latencyMs: Date.now() - startTime },
        audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), idempotencyKey: options?.idempotencyKey },
        nextSuggestions: ['Review tool inputSchema and correct parameter format'],
      };
      await this.eventBus.publish('tool.failed', { toolId: cleanId, error: valErr.message }, context);
      return errEnvelope;
    }

    // Step 4: Dry-Run Branch
    if (options?.dryRun) {
      if (!tool.supportsDryRun || !tool.dryRun) {
        return {
          success: false,
          summary: `Tool '${tool.name}' does not support dry-run execution`,
          warnings: [],
          errors: ['Dry-run not supported'],
          metrics: { latencyMs: Date.now() - startTime },
          audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), dryRun: true },
          nextSuggestions: ['Execute directly without dryRun option'],
        };
      }

      await this.eventBus.publish('tool.dry_run', { toolId: cleanId, input: validatedInput }, context);
      const dryResult = await tool.dryRun(validatedInput, context);
      
      const dryEnvelope: ToolResultEnvelope<TOutput> = {
        success: dryResult.validationErrors.length === 0,
        summary: `[DRY RUN] ${dryResult.summary}`,
        warnings: [`${dryResult.recordsModified} records will be modified`, `Affected IDs: ${dryResult.affectedIds.join(', ')}`],
        errors: dryResult.validationErrors,
        metrics: { latencyMs: Date.now() - startTime },
        audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), dryRun: true },
        nextSuggestions: dryResult.validationErrors.length === 0 ? ['Proceed with actual execution by removing dryRun flag'] : ['Fix validation errors before executing'],
      };
      return dryEnvelope;
    }

    // Step 5: Undo Branch
    if (options?.undo) {
      if (!tool.supportsUndo || !tool.undo || !options.previousResult) {
        return {
          success: false,
          summary: `Tool '${tool.name}' does not support undo or previousResult was missing`,
          warnings: [],
          errors: ['Undo not supported or missing previous state'],
          metrics: { latencyMs: Date.now() - startTime },
          audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), undone: true },
          nextSuggestions: [],
        };
      }

      await this.eventBus.publish('tool.undone', { toolId: cleanId, idempotencyKey: options.idempotencyKey }, context);
      const undoEnvelope = await tool.undo(validatedInput, context, options.previousResult, options.idempotencyKey);
      return undoEnvelope as ToolResultEnvelope<TOutput>;
    }

    // Step 6: Actual Execution with Timeout & Retry
    await this.eventBus.publish('tool.started', { toolId: cleanId, input: validatedInput }, context);
    const timeoutMs = options?.timeoutMs || 30000;
    const maxRetries = options?.maxRetries ?? 1;

    try {
      const rawEnvelope = await withRetry(
        async () => await withTimeout(
          async () => await tool.execute(validatedInput, context, options),
          { timeoutMs, provider: 'tool' }
        ),
        { maxRetries }
      );

      const latencyMs = Date.now() - startTime;
      this.registry.recordMetrics(cleanId, latencyMs, rawEnvelope.success, rawEnvelope.metrics.tokensUsed, rawEnvelope.metrics.costUsd);

      let validatedData = rawEnvelope.data;
      if (rawEnvelope.success && rawEnvelope.data !== undefined) {
        try {
          validatedData = this.validator.validateOutput(tool, rawEnvelope.data);
        } catch (outErr: any) {
          rawEnvelope.warnings.push(`Output validation warning: ${outErr.message}`);
        }
      }

      const finalEnvelope: ToolResultEnvelope<TOutput> = {
        ...rawEnvelope,
        data: validatedData,
        metrics: { ...rawEnvelope.metrics, latencyMs },
        audit: {
          toolId: cleanId,
          version: versionStr,
          traceId: context.traceId,
          timestamp: new Date(),
          idempotencyKey: options?.idempotencyKey,
        },
      };

      if (options?.idempotencyKey && finalEnvelope.success) {
        this.idempotencyCache.set(options.idempotencyKey, finalEnvelope);
      }

      await this.eventBus.publish('tool.completed', { toolId: cleanId, success: finalEnvelope.success, latencyMs }, context);
      return finalEnvelope;
    } catch (execErr: any) {
      const latencyMs = Date.now() - startTime;
      this.registry.recordMetrics(cleanId, latencyMs, false);

      const errEnvelope: ToolResultEnvelope<TOutput> = {
        success: false,
        summary: `Execution failed for tool '${tool.name}': ${execErr.message}`,
        warnings: [],
        errors: [execErr.message || 'Unknown tool execution error'],
        metrics: { latencyMs },
        audit: { toolId: cleanId, version: versionStr, traceId: context.traceId, timestamp: new Date(), idempotencyKey: options?.idempotencyKey },
        nextSuggestions: ['Check network connectivity or external API status', 'Retry with exponential backoff'],
      };

      await this.eventBus.publish('tool.failed', { toolId: cleanId, error: execErr.message }, context);
      return errEnvelope;
    }
  }

  /**
   * Clear idempotency cache (useful for testing or memory reclamation).
   */
  clearIdempotencyCache(): void {
    this.idempotencyCache.clear();
  }
}

export const defaultToolExecutor = new ToolExecutor();
