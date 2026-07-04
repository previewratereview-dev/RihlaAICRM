/**
 * StateAI AI Operating System (AIOS) — AI Kernel
 * 
 * The authoritative entry point for all AIOS executions.
 * Enforces: User -> AIKernel -> PolicyEngine -> FeatureFlags -> ResourceManager -> Hooks -> InferenceManager -> Provider.
 * Generates AIExecutionContext and Trace IDs, logs telemetry, manages execution state machine, and broadcasts events.
 */

import type { AIExecutionContext, CompletionOptions, CompletionResponse, StreamingChunk, ExecutionState } from '../types';
import { defaultInferenceManager, type InferenceManager } from '../inference';
import { defaultPolicyEngine, type PolicyEngine, type PolicyAction } from '../policies';
import { defaultFeatureFlagManager, type FeatureFlagManager, generateTraceId } from '../security';
import { defaultEventBus, type EventBus } from '../events';
import { defaultTelemetry, type Telemetry } from '../telemetry';
import { defaultResourceManager, type ResourceManager } from '../resources';
import { defaultHookManager, type HookManager } from './hooks';
import { ProviderConfigurationError, RateLimitError } from '../errors';

export interface KernelExecutionOptions extends CompletionOptions {
  tenantId?: string;
  userId?: string;
  action?: PolicyAction;
  resource?: Record<string, unknown>;
  traceId?: string;
}

export class AIKernel {
  private inferenceManager: InferenceManager;
  private policyEngine: PolicyEngine;
  private featureFlagManager: FeatureFlagManager;
  private eventBus: EventBus;
  private telemetry: Telemetry;
  private resourceManager: ResourceManager;
  private hookManager: HookManager;

  constructor(
    inferenceManager: InferenceManager = defaultInferenceManager,
    policyEngine: PolicyEngine = defaultPolicyEngine,
    featureFlagManager: FeatureFlagManager = defaultFeatureFlagManager,
    eventBus: EventBus = defaultEventBus,
    telemetry: Telemetry = defaultTelemetry,
    resourceManager: ResourceManager = defaultResourceManager,
    hookManager: HookManager = defaultHookManager
  ) {
    this.inferenceManager = inferenceManager;
    this.policyEngine = policyEngine;
    this.featureFlagManager = featureFlagManager;
    this.eventBus = eventBus;
    this.telemetry = telemetry;
    this.resourceManager = resourceManager;
    this.hookManager = hookManager;
  }

  /**
   * Helper to transition execution state machine and record history.
   */
  private updateState(context: AIExecutionContext, state: ExecutionState, reason?: string): void {
    context.state = state;
    context.stateHistory.push({ state, timestamp: new Date(), reason });
  }

  /**
   * Execute a synchronous completion request through the AI Kernel.
   */
  async execute(options: KernelExecutionOptions): Promise<CompletionResponse> {
    const context = this.createExecutionContext(options);
    const startTime = Date.now();

    this.updateState(context, 'queued');
    await this.eventBus.publish('kernel.started', { traceId: context.traceId, model: options.model }, context);
    await this.telemetry.logEvent({ name: 'kernel.started', traceId: context.traceId, tenantId: context.tenantId, userId: context.userId });

    // Step 1: Resource Manager Budget & Concurrency Check
    const estimatedTokens = options.maxTokens || 1024;
    if (!await this.resourceManager.checkTokenBudget(context.tenantId, estimatedTokens)) {
      this.updateState(context, 'failed', 'Token budget or monthly USD budget exceeded');
      throw new RateLimitError('kernel', 60);
    }
    if (!await this.resourceManager.acquireConcurrency(context.tenantId)) {
      this.updateState(context, 'failed', 'Max concurrent inferences limit reached');
      throw new RateLimitError('kernel', 5);
    }

    try {
      // Step 2: Evaluate Policy Governance
      if (options.action) {
        const decision = await this.policyEngine.evaluate(context, options.action, options.resource);
        await this.eventBus.publish('policy.evaluated', { action: options.action, decision }, context);
        
        if (!decision.allowed) {
          this.updateState(context, 'failed', `Policy check denied action '${options.action}': ${decision.reason}`);
          await this.eventBus.publish('policy.denied', { action: options.action, reason: decision.reason }, context);
          throw new ProviderConfigurationError('kernel', `Policy check denied action '${options.action}': ${decision.reason}`);
        }
        if (decision.requiresHITL) {
          this.updateState(context, 'waiting_hitl', decision.reason);
          // In synchronous execution, requiring HITL without pre-approval throws or returns approval request
        }
      }

      // Step 3: Lifecycle Hooks (beforeExecution & beforeProvider)
      this.updateState(context, 'executing');
      await this.hookManager.beforeExecution(context, options);
      await this.hookManager.beforeProvider(context, 'unknown', options.model);

      // Step 4: Route through InferenceManager with automated failover
      await this.eventBus.publish('inference.started', { model: options.model }, context);
      const response = await this.inferenceManager.executeWithFallback(options, options.metadata?.fallbackProviders as string[]);
      
      const latencyMs = Date.now() - startTime;
      this.updateState(context, 'completed');

      // Step 5: Resource usage tracking & Lifecycle Hooks
      const totalTokens = response.usage?.totalTokens || 0;
      const costUsd = response.usage?.estimatedCost || 0;
      await this.resourceManager.recordTokenUsage(context.tenantId, totalTokens, costUsd);
      await this.hookManager.afterProvider(context, response.provider, response.model, latencyMs);
      await this.hookManager.afterExecution(context, response);

      await this.eventBus.publish('inference.completed', { model: response.model, provider: response.provider, latencyMs, usage: response.usage }, context);
      await this.eventBus.publish('kernel.completed', { traceId: context.traceId, latencyMs }, context);
      
      return response;
    } catch (err) {
      this.updateState(context, 'failed', err instanceof Error ? err.message : String(err));
      await this.eventBus.publish('inference.failed', { error: err instanceof Error ? err.message : String(err) }, context);
      await this.telemetry.logError(err, { traceId: context.traceId, tenantId: context.tenantId });
      throw err;
    } finally {
      await this.resourceManager.releaseConcurrency(context.tenantId);
    }
  }

  /**
   * Execute a streaming completion request through the AI Kernel.
   */
  async *stream(options: KernelExecutionOptions): AsyncIterable<StreamingChunk> {
    const context = this.createExecutionContext(options);
    this.updateState(context, 'queued');

    await this.eventBus.publish('kernel.started', { traceId: context.traceId, model: options.model, streaming: true }, context);

    if (!await this.resourceManager.acquireConcurrency(context.tenantId)) {
      this.updateState(context, 'failed', 'Max concurrent inferences limit reached');
      throw new RateLimitError('kernel', 5);
    }

    try {
      if (options.action) {
        const decision = await this.policyEngine.evaluate(context, options.action, options.resource);
        if (!decision.allowed) {
          this.updateState(context, 'failed', `Policy check denied action '${options.action}': ${decision.reason}`);
          throw new ProviderConfigurationError('kernel', `Policy check denied action '${options.action}': ${decision.reason}`);
        }
      }

      this.updateState(context, 'executing');
      await this.hookManager.beforeExecution(context, options);
      await this.eventBus.publish('inference.started', { model: options.model, streaming: true }, context);
      
      const stream = this.inferenceManager.stream(options);
      for await (const chunk of stream) {
        yield chunk;
      }

      this.updateState(context, 'completed');
      await this.eventBus.publish('kernel.completed', { traceId: context.traceId, streaming: true }, context);
    } finally {
      await this.resourceManager.releaseConcurrency(context.tenantId);
    }
  }

  /**
   * Generates a fully populated AIExecutionContext for the current invocation.
   */
  private createExecutionContext(options: KernelExecutionOptions): AIExecutionContext {
    const tenantId = options.tenantId || 'global';
    const now = new Date();
    return {
      requestId: `req_${Math.random().toString(36).substring(2, 11)}`,
      tenantId,
      userId: options.userId || 'anonymous',
      traceId: options.traceId || generateTraceId(),
      provider: 'unknown', // Resolved during inference
      model: options.model,
      cost: 0,
      startTime: now,
      state: 'created',
      stateHistory: [{ state: 'created', timestamp: now }],
      features: {
        planner: this.featureFlagManager.isEnabled(tenantId, 'enablePlanner'),
        memory: this.featureFlagManager.isEnabled(tenantId, 'enableMemory'),
        workflow: this.featureFlagManager.isEnabled(tenantId, 'enableWorkflow'),
        vision: this.featureFlagManager.isEnabled(tenantId, 'enableVision'),
        automation: this.featureFlagManager.isEnabled(tenantId, 'enableAutomation'),
      },
      permissions: [],
      metadata: options.metadata || {},
    };
  }
}

export const defaultKernel = new AIKernel();
