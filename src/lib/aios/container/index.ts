/**
 * StateAI AI Operating System (AIOS) — Dependency Injection Container
 * 
 * Central IoC / DI Container managing all 13 AIOS subsystems.
 * Replaces hardcoded global singletons with clean dependency injection,
 * making testing, tenant isolation, and custom subsystem swapping seamless.
 */

import { AIKernel, defaultKernel, HookManager, defaultHookManager } from '../kernel';
import { InferenceManager, defaultInferenceManager, HealthManager, defaultHealthManager } from '../inference';
import { ModelRegistry, defaultModelRegistry } from '../models';
import { CapabilityRegistry, defaultCapabilityRegistry } from '../capabilities';
import { EventBus, defaultEventBus } from '../events';
import { PolicyEngine, defaultPolicyEngine } from '../policies';
import { FeatureFlagManager, defaultFeatureFlagManager } from '../security';
import { Telemetry, defaultTelemetry } from '../telemetry';
import { ResourceManager, defaultResourceManager } from '../resources';
import { PluginManager, defaultPluginManager } from '../plugins';
import {
  ToolRegistry,
  defaultToolRegistry,
  ToolExecutor,
  defaultToolExecutor,
  ToolLoader,
  defaultToolLoader,
  ToolValidator,
  defaultToolValidator,
  ToolPermissionGuard,
  defaultToolPermissionGuard,
} from '../tools';
import {
  ContextEngine,
  defaultContextEngine,
  ContextRanker,
  defaultContextRanker,
  ContextBudgetManager,
  defaultContextBudgetManager,
  ContextCompressor,
  defaultContextCompressor,
  EntityExtractor,
  defaultEntityExtractor,
} from '../context';
import {
  VectorStore,
  defaultVectorStore,
  RetrievalPipeline,
  defaultRetrievalPipeline,
  QueryRewriter,
  defaultQueryRewriter,
  MultiQueryRetriever,
  defaultMultiQueryRetriever,
  CrossEncoderReranker,
  defaultCrossEncoderReranker,
  RetrievalPolicyEngine,
  defaultRetrievalPolicyEngine,
} from '../knowledge';
import { EvaluationEngine, defaultEvaluationEngine } from '../evaluation';
import { LearningEngine, defaultLearningEngine } from '../learning';

export class AIOSContainer {
  private kernelInstance: AIKernel;
  private inferenceManagerInstance: InferenceManager;
  private healthManagerInstance: HealthManager;
  private modelRegistryInstance: ModelRegistry;
  private capabilityRegistryInstance: CapabilityRegistry;
  private eventBusInstance: EventBus;
  private policyEngineInstance: PolicyEngine;
  private featureFlagManagerInstance: FeatureFlagManager;
  private telemetryInstance: Telemetry;
  private resourceManagerInstance: ResourceManager;
  private pluginManagerInstance: PluginManager;
  private hookManagerInstance: HookManager;
  private toolRegistryInstance: ToolRegistry;
  private toolExecutorInstance: ToolExecutor;
  private toolLoaderInstance: ToolLoader;
  private toolValidatorInstance: ToolValidator;
  private toolPermissionGuardInstance: ToolPermissionGuard;
  private contextEngineInstance: ContextEngine;
  private contextRankerInstance: ContextRanker;
  private contextBudgetManagerInstance: ContextBudgetManager;
  private contextCompressorInstance: ContextCompressor;
  private entityExtractorInstance: EntityExtractor;
  private vectorStoreInstance: VectorStore;
  private retrievalPipelineInstance: RetrievalPipeline;
  private queryRewriterInstance: QueryRewriter;
  private multiQueryRetrieverInstance: MultiQueryRetriever;
  private crossEncoderRerankerInstance: CrossEncoderReranker;
  private retrievalPolicyEngineInstance: RetrievalPolicyEngine;
  private evaluationEngineInstance: EvaluationEngine;
  private learningEngineInstance: LearningEngine;

  constructor() {
    // Bind default production instances
    this.eventBusInstance = defaultEventBus;
    this.telemetryInstance = defaultTelemetry;
    this.capabilityRegistryInstance = defaultCapabilityRegistry;
    this.modelRegistryInstance = defaultModelRegistry;
    this.healthManagerInstance = defaultHealthManager;
    this.inferenceManagerInstance = defaultInferenceManager;
    this.policyEngineInstance = defaultPolicyEngine;
    this.featureFlagManagerInstance = defaultFeatureFlagManager;
    this.resourceManagerInstance = defaultResourceManager;
    this.pluginManagerInstance = defaultPluginManager;
    this.hookManagerInstance = defaultHookManager;
    this.toolRegistryInstance = defaultToolRegistry;
    this.toolExecutorInstance = defaultToolExecutor;
    this.toolLoaderInstance = defaultToolLoader;
    this.toolValidatorInstance = defaultToolValidator;
    this.toolPermissionGuardInstance = defaultToolPermissionGuard;
    this.contextEngineInstance = defaultContextEngine;
    this.contextRankerInstance = defaultContextRanker;
    this.contextBudgetManagerInstance = defaultContextBudgetManager;
    this.contextCompressorInstance = defaultContextCompressor;
    this.entityExtractorInstance = defaultEntityExtractor;
    this.vectorStoreInstance = defaultVectorStore;
    this.retrievalPipelineInstance = defaultRetrievalPipeline;
    this.queryRewriterInstance = defaultQueryRewriter;
    this.multiQueryRetrieverInstance = defaultMultiQueryRetriever;
    this.crossEncoderRerankerInstance = defaultCrossEncoderReranker;
    this.retrievalPolicyEngineInstance = defaultRetrievalPolicyEngine;
    this.evaluationEngineInstance = defaultEvaluationEngine;
    this.learningEngineInstance = defaultLearningEngine;
    this.kernelInstance = defaultKernel;
  }

  resolveKernel(): AIKernel { return this.kernelInstance; }
  resolveInferenceManager(): InferenceManager { return this.inferenceManagerInstance; }
  resolveHealthManager(): HealthManager { return this.healthManagerInstance; }
  resolveModelRegistry(): ModelRegistry { return this.modelRegistryInstance; }
  resolveCapabilityRegistry(): CapabilityRegistry { return this.capabilityRegistryInstance; }
  resolveEventBus(): EventBus { return this.eventBusInstance; }
  resolvePolicyEngine(): PolicyEngine { return this.policyEngineInstance; }
  resolveFeatureFlagManager(): FeatureFlagManager { return this.featureFlagManagerInstance; }
  resolveTelemetry(): Telemetry { return this.telemetryInstance; }
  resolveResourceManager(): ResourceManager { return this.resourceManagerInstance; }
  resolvePluginManager(): PluginManager { return this.pluginManagerInstance; }
  resolveHookManager(): HookManager { return this.hookManagerInstance; }
  resolveToolRegistry(): ToolRegistry { return this.toolRegistryInstance; }
  resolveToolExecutor(): ToolExecutor { return this.toolExecutorInstance; }
  resolveToolLoader(): ToolLoader { return this.toolLoaderInstance; }
  resolveToolValidator(): ToolValidator { return this.toolValidatorInstance; }
  resolveToolPermissionGuard(): ToolPermissionGuard { return this.toolPermissionGuardInstance; }
  resolveContextEngine(): ContextEngine { return this.contextEngineInstance; }
  resolveContextBuilder(): ContextEngine { return this.contextEngineInstance; }
  resolveContextRanker(): ContextRanker { return this.contextRankerInstance; }
  resolveContextBudgetManager(): ContextBudgetManager { return this.contextBudgetManagerInstance; }
  resolveContextCompressor(): ContextCompressor { return this.contextCompressorInstance; }
  resolveEntityExtractor(): EntityExtractor { return this.entityExtractorInstance; }
  resolveVectorStore(): VectorStore { return this.vectorStoreInstance; }
  resolveRetrievalPipeline(): RetrievalPipeline { return this.retrievalPipelineInstance; }
  resolveQueryRewriter(): QueryRewriter { return this.queryRewriterInstance; }
  resolveMultiQueryRetriever(): MultiQueryRetriever { return this.multiQueryRetrieverInstance; }
  resolveCrossEncoderReranker(): CrossEncoderReranker { return this.crossEncoderRerankerInstance; }
  resolveRetrievalPolicyEngine(): RetrievalPolicyEngine { return this.retrievalPolicyEngineInstance; }
  resolveEvaluationEngine(): EvaluationEngine { return this.evaluationEngineInstance; }
  resolveLearningEngine(): LearningEngine { return this.learningEngineInstance; }

  // Custom overrides for testing or specialized multi-tenant isolation
  bindKernel(kernel: AIKernel): void { this.kernelInstance = kernel; }
  bindInferenceManager(manager: InferenceManager): void { this.inferenceManagerInstance = manager; }
  bindHealthManager(manager: HealthManager): void { this.healthManagerInstance = manager; }
  bindModelRegistry(registry: ModelRegistry): void { this.modelRegistryInstance = registry; }
  bindCapabilityRegistry(registry: CapabilityRegistry): void { this.capabilityRegistryInstance = registry; }
  bindEventBus(bus: EventBus): void { this.eventBusInstance = bus; }
  bindPolicyEngine(engine: PolicyEngine): void { this.policyEngineInstance = engine; }
  bindFeatureFlagManager(manager: FeatureFlagManager): void { this.featureFlagManagerInstance = manager; }
  bindTelemetry(telemetry: Telemetry): void { this.telemetryInstance = telemetry; }
  bindResourceManager(manager: ResourceManager): void { this.resourceManagerInstance = manager; }
  bindPluginManager(manager: PluginManager): void { this.pluginManagerInstance = manager; }
  bindHookManager(manager: HookManager): void { this.hookManagerInstance = manager; }
  bindToolRegistry(registry: ToolRegistry): void { this.toolRegistryInstance = registry; }
  bindToolExecutor(executor: ToolExecutor): void { this.toolExecutorInstance = executor; }
  bindToolLoader(loader: ToolLoader): void { this.toolLoaderInstance = loader; }
  bindToolValidator(validator: ToolValidator): void { this.toolValidatorInstance = validator; }
  bindToolPermissionGuard(guard: ToolPermissionGuard): void { this.toolPermissionGuardInstance = guard; }
  bindContextEngine(engine: ContextEngine): void { this.contextEngineInstance = engine; }
  bindContextBuilder(builder: ContextEngine): void { this.contextEngineInstance = builder; }
  bindContextRanker(ranker: ContextRanker): void { this.contextRankerInstance = ranker; }
  bindContextBudgetManager(manager: ContextBudgetManager): void { this.contextBudgetManagerInstance = manager; }
  bindContextCompressor(compressor: ContextCompressor): void { this.contextCompressorInstance = compressor; }
  bindEntityExtractor(extractor: EntityExtractor): void { this.entityExtractorInstance = extractor; }
  bindVectorStore(store: VectorStore): void { this.vectorStoreInstance = store; }
  bindRetrievalPipeline(pipeline: RetrievalPipeline): void { this.retrievalPipelineInstance = pipeline; }
  bindQueryRewriter(rewriter: QueryRewriter): void { this.queryRewriterInstance = rewriter; }
  bindMultiQueryRetriever(retriever: MultiQueryRetriever): void { this.multiQueryRetrieverInstance = retriever; }
  bindCrossEncoderReranker(reranker: CrossEncoderReranker): void { this.crossEncoderRerankerInstance = reranker; }
  bindRetrievalPolicyEngine(engine: RetrievalPolicyEngine): void { this.retrievalPolicyEngineInstance = engine; }
  bindEvaluationEngine(engine: EvaluationEngine): void { this.evaluationEngineInstance = engine; }
  bindLearningEngine(engine: LearningEngine): void { this.learningEngineInstance = engine; }
}

export const container = new AIOSContainer();
