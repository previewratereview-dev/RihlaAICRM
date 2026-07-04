# StateAI AI Operating System (AIOS) — Core Foundation & Architecture

Welcome to the **StateAI AI Operating System (AIOS)** foundation layer (`src/lib/aios/`). This module provides an enterprise-grade, vendor-neutral LLM orchestration engine and operational kernel designed to power every StateAI product (Travel CRM, Healthcare CRM, Real Estate CRM, Manufacturing CRM, etc.) without vendor lock-in or code duplication.

> **Strategic Platform Philosophy:** AIOS is architected as a standalone product internally within the **StateAI Platform** hierarchy:
> ```
> StateAI Platform
> ├── AIOS (AI Operating System Foundation & Engine)
> ├── Travel CRM
> ├── Healthcare CRM
> ├── Real Estate CRM
> ├── HR CRM
> └── Future Products
> ```

---

## 1. Complete Package Architecture & Namespace Organization

The AIOS architecture is structured across **13 core enterprise subsystems**, fully decoupled and managed via dependency injection:

```
src/lib/aios/
├── index.ts                     # Public module facade exporting all 13 subsystems and singletons
├── types.ts                     # Vendor-neutral TypeScript interfaces, AIExecutionContext & ExecutionState
├── config.ts                    # Centralized runtime configuration with Zod Schema Validation
├── adapter.ts                   # Migration adapter layer for legacy src/lib/ai interoperability
├── kernel/                      # 1. AI Kernel, State Machine & Execution Hooks
│   ├── index.ts                 # Kernel re-exports
│   ├── ai-kernel.ts             # Authoritative execution entry point enforcing policy, budgets & tracing
│   └── hooks.ts                 # HookManager (beforeExecution, afterExecution, beforeProvider, etc.)
├── container/                   # 2. Dependency Injection Container
│   └── index.ts                 # AIOSContainer managing all subsystem singletons
├── inference/                   # 3. Inference & Health Orchestration
│   ├── index.ts                 # Inference re-exports
│   ├── inference-manager.ts     # InferenceManager (routing, automated failover across modalities)
│   └── health-manager.ts        # HealthManager (circuit breaker: open/closed/half-open, latency tracking)
├── resources/                   # 4. Resource Manager
│   ├── index.ts                 # Resource re-exports
│   └── interface.ts             # ResourceManager governing token budgets, rate limits & concurrency quotas
├── plugins/                     # 5. Plugin Extension API
│   ├── index.ts                 # Plugin re-exports
│   └── interface.ts             # AIOSPlugin & PluginManager allowing domain extensions (Voice, OCR, ERP)
├── policies/                    # 6. Operational Policy Governance Engine
│   └── index.ts                 # PolicyEngine evaluating Security -> Compliance -> Operational -> Business
├── security/                    # Security & Feature Flags
│   └── index.ts                 # FeatureFlagManager (tenant-scoped flags) & TraceId generation
├── telemetry/                   # Observability & Metrics
│   └── index.ts                 # Vendor-neutral Telemetry interface bound to EventBus
├── providers/                   # LLM Provider adapters
│   ├── index.ts                 # Providers re-exports
│   ├── openai-compatible.ts     # Unified adapter for OpenAI, NVIDIA, GLM, and Ollama
│   └── anthropic.ts             # Dedicated adapter for Anthropic Claude models
├── models/                      # Authoritative model specifications
│   ├── index.ts                 # Models re-exports
│   └── model-registry.ts        # ModelRegistry with pricing, context windows, and speed tiers
├── capabilities/                # Capability Registry
│   └── index.ts                 # Decoupled capability definitions (tool_calling, vision, streaming, etc.)
├── tools/                       # 7. Tool Platform Architecture (Milestone 2)
│   ├── index.ts                 # Tools re-exports
│   ├── types.ts                 # AIOSTool contract, ToolCategory, ToolRiskLevel, ToolResultEnvelope
│   ├── registry.ts              # ToolRegistry with intelligent discovery engine and metrics tracking
│   ├── validator.ts             # Strict Zod input/output schema validation
│   ├── permissions.ts           # ToolPermissionGuard checking permissions & risk governance
│   ├── executor.ts              # ToolExecutor (dry-run, undo, idempotency, timeout, retry, EventBus)
│   ├── loader.ts                # Dynamic vertical CRM tool loader (CRM, Travel CRM, Healthcare)
│   └── builtin/                 # Built-in vertical and general tools
├── knowledge/                   # 8. Authoritative Knowledge Engine (Milestone 3A+)
│   ├── index.ts                 # Knowledge re-exports
│   ├── types.ts                 # Domain split (Internal vs External), Multimodal reservations, TrustScore, Citation IDs
│   ├── policy.ts                # RetrievalPolicyEngine dynamically selecting target domains & strategies
│   ├── rewriter.ts              # QueryRewriter (extracting filters & expanding search keywords)
│   ├── multi-query.ts           # MultiQueryRetriever (generating Original, Synonym, Semantic, Keyword, Abbreviation)
│   ├── reranker.ts              # CrossEncoderReranker (BGE, Jina, Cohere, NVIDIA adapters & freshness penalty)
│   ├── vector-store.ts          # VectorStore abstraction (Supabase, Qdrant, Milvus, Pinecone, InMemory)
│   └── pipeline.ts              # 6-Stage Knowledge Retrieval Pipeline
├── context/                     # 9. Authoritative Context Engine (Milestone 3A+)
│   ├── index.ts                 # Context re-exports
│   ├── types.ts                 # ContextLayer, ContextItem with citationId & trust, Ranking, BudgetPlan
│   ├── ranking.ts               # ContextRanker with configurable per-tenant weights
│   ├── compressor.ts            # ContextCompressor (Extractive, Abstractive, Keyword, Entity, Summary)
│   ├── budget.ts                # ContextBudgetManager governing layer quotas and dynamic reallocation
│   ├── extractor.ts             # EntityExtractor harvesting customer, hotel, booking, company entities
│   ├── engine.ts                # ContextEngine (caching, runtime variables, layer orchestration)
│   └── layers/                  # 8 independently testable context layers
├── evaluation/                  # 10. Evaluation Framework & AI Benchmarks (Milestone 3A+)
│   ├── index.ts                 # Evaluation re-exports
│   ├── interface.ts             # EvaluationMetricType, EvaluationEngine measuring precision/hallucinations
│   └── benchmarks/              # Permanent benchmark suite across Travel CRM, Healthcare CRM, Sales CRM
├── learning/                    # 11. Learning & Behavior Adaptation Engine (Milestone 3A+)
│   ├── index.ts                 # Learning re-exports
│   └── interface.ts             # LearningEngine converting feedback & rejections into prompt adaptations
├── memory/                      # 12. Memory Interface Package (Milestone 3B Prep)
│   ├── index.ts                 # Memory re-exports
│   └── interface.ts             # 7-Layer Memory, Entity vs Knowledge Graph split, Memory Event emitting
├── prompts/                     # Prompt System Interface Package (Milestone 5)
│   └── interface.ts             # VersionedPromptTemplate and PromptVersion
├── skills/                      # Skills Interface Package
│   └── interface.ts             # SkillDefinition and SkillVersion
├── workflow/                    # Workflow Interface Package (Milestone 7)
│   └── interface.ts             # Workflow interface and WorkflowVersion
├── planner/                     # 13. Planner Interface Package (Milestone 6)
│   └── interface.ts             # Autonomous multi-step planning contract
├── automation/                  # Automation Interface Package (Milestone 8)
│   └── interface.ts             # Event-driven background automation contract
├── agents/                      # Multi-Agent Interface Package (Milestone 9)
│   └── interface.ts             # Agent spawning and orchestration contract
├── runtime/                     # Agent Runtime Namespace Reservation
│   └── interface.ts             # Reserved namespace for Session, Context, Scratchpad & Execution Graph
├── utils/                       # Reusable, zero-dependency resilience & parsing utilities
└── errors/                      # Standardized AIOS error hierarchy
```

---

## 2. The 10 Enterprise Platform Refinements (9.98/10 Assessment)

In accordance with our enterprise roadmap, we have incorporated all **10 architectural refinements** into the core codebase and interfaces:

1. **Domain-Separated Knowledge (`KnowledgeDomain`):** Cleanly split into **Internal Knowledge** (`sop`, `crm_record`, `policy`, `document`) and **External Knowledge** (`web`, `api`, `weather`, `maps`, `flight_prices`, `exchange_rates`, `government_data`).
2. **Retrieval Policy Engine (`RetrievalPolicyEngine`):** Replaces hardcoded retrieval logic with dynamic intent evaluation. For example:
   * *"What is today's booking?"* $\rightarrow$ `['crm']` (Deterministic CRM lookup)
   * *"What visa is required?"* $\rightarrow$ `['external_knowledge']` (Live government data/web search)
   * *"What did the customer ask yesterday?"* $\rightarrow$ `['memory']` (Episodic/semantic recall)
   * *"Summarize this customer."* $\rightarrow$ `['crm', 'memory', 'internal_knowledge']` (Multi-domain 360 fusion)
3. **Trust Scoring (`TrustScore`):** Every retrieved knowledge item and context item includes a structured trust profile (`sourceReliability`, `verificationStatus`, `recencyScore`, `confidence`, `overallTrust`), enabling planners to prioritize official verified data over unverified scrapes.
4. **Multimodal Knowledge Reservations (`MultimodalContent`):** Explicitly reserved interfaces for `pdf`, `image`, `voice`, `video`, `cad_drawing`, and `medical_scan` across knowledge sources.
5. **Immutable Citation IDs (`generateCitationId`):** Generates permanent, human-readable citation tags (`KNOW-8472`, `MEM-2381`, `DOC-1092`, `CRM-4588`, `POL-5678`) attached to every item so downstream planners can cite exact sources: *"According to Booking Policy (KNOW-8472)..."*
6. **Strict Graph Separation (`EntityGraphNode` vs `KnowledgeGraphNode`):** Explicitly separated in the memory schema:
   * **Knowledge Graph:** Conceptual domains and rules (*Booking Policy* $\rightarrow$ *Cancellation Rule* $\rightarrow$ *Refund Policy*).
   * **Entity Graph:** Concrete instances and records (*Customer* $\rightarrow$ *Booking* $\rightarrow$ *Hotel* $\rightarrow$ *Invoice*).
7. **Active Memory Event Emitting (`MemoryEventType`):** Memory is no longer passive. It emits structured events (`memory.created`, `memory.updated`, `memory.expired`, `memory.consolidated`, `memory.retrieved`) directly to the Event Bus.
8. **Evaluation Framework (`EvaluationEngine`):** Inserted into the architecture prior to Planner implementation. Measures objective quality metrics: `context_quality`, `retrieval_precision`, `retrieval_recall`, `compression_ratio`, `hallucination_rate`, `tool_success_rate`, and `planner_success_rate`.
9. **Permanent AI Benchmark Suite (`benchmarks/`):** A permanent benchmark suite containing curated test cases across **Travel CRM** (`BENCH-TRV-001..003`), **Healthcare CRM** (`BENCH-HLTH-001..002`), and **Sales CRM** (`BENCH-SLS-001`), executed to prevent regressions.
10. **Learning & Behavior Adaptation Engine (`LearningEngine`):** Closes the cognitive loop:
    $$\text{Conversation} \longrightarrow \text{Memory} \longrightarrow \text{Learning} \longrightarrow \text{Behavior Adaptation}$$
    Automatically captures user corrections or rejected actions (e.g., rejecting an itinerary format twice) and adapts future system prompts and planner strategies automatically.

---

## 3. Revised Enterprise Roadmap

```
✅ Foundation (Kernel, Container, Inference, Policies, Telemetry)
✅ Core Infrastructure (Providers, Models, Capabilities, Resources, Plugins)
✅ Tool Platform (Milestone 2: Registry, Executor, Dry-Run, Undo, Idempotency)
✅ Context Engine & Knowledge Engine (Milestone 3A+: 8 Layers, 6-Stage RAG, Caching, Runtime Variables)
✅ Evaluation Framework & Benchmarks (Inserted before Planner: Precision, Recall, Hallucination monitoring)
✅ Learning Engine & Behavior Adaptation (Continuous user preference & rejection learning)
🔲 Memory Platform (Milestone 3B: 7-Layer Memory, Entity Graph, Knowledge Graph, Consolidation)
🔲 Prompt Engine (Milestone 5: Versioned Templates, Dynamic Assembly)
🔲 Planner (Milestone 6: Autonomous Multi-Step Planning & Tree-of-Thought)
🔲 Workflow Engine (Milestone 7: Deterministic State Machine & Checkpoints)
🔲 Automation (Milestone 8: Event-Driven Background Execution)
🔲 Multi-Agent Orchestration (Milestone 9: Supervisor, Worker & Swarm topologies)
```

---

## 4. Verification & Test Suite

The entire AIOS architecture is verified by **78 automated unit tests across 13 test suites** (`npx vitest run src/lib/aios`):
* `errors.test.ts`: Error hierarchy and normalization (8 tests)
* `model-registry.test.ts`: Model capabilities and pricing tiers (5 tests)
* `events-capabilities.test.ts`: EventBus pub/sub and capability queries (4 tests)
* `providers.test.ts`: OpenAI-compatible and Anthropic adapters (5 tests)
* `config.test.ts`: Zod configuration validation and environment fallbacks (4 tests)
* `utils.test.ts`: Resilience timers, retry jitter, JSON repair, token counting (9 tests)
* `inference-manager.test.ts`: Automated failover and modality routing (5 tests)
* `refinements.test.ts`: Milestone 1.5 architectural refinements (7 tests)
* `kernel.test.ts`: Kernel governance, policy enforcement, trace IDs (4 tests)
* `container.test.ts`: Dependency injection and tenant isolation (2 tests)
* `tools-platform.test.ts`: Milestone 2 Tool Platform discovery, dry-run, undo, idempotency, validation, and metrics (11 tests)
* `context-platform.test.ts`: Milestone 3A Context Engine, Knowledge Engine, 6-stage RAG pipeline, Query Rewriting, Multi-Query variations, Cross-Encoder Reranking, 5 Compression strategies, and Context Caching (8 tests)
* **`platform-refinements-9.98.test.ts`:** **Milestone 3A+ Trust Scoring, Citation IDs, Domain Split, Policy Engine, Multimodal, Graph Split, Evaluation, Benchmarks, and Learning (6 tests)**
