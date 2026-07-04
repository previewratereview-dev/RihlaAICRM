/**
 * StateAI AI Operating System (AIOS) — Capability Registry
 * 
 * Authoritative registry of model and provider capabilities.
 * Decouples capability definitions (e.g. tool_calling, vision, streaming, reasoning)
 * from hardcoded boolean properties on individual model records.
 */

export interface CapabilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: 'core' | 'modality' | 'reasoning' | 'format' | 'execution' | 'tier';
}

export class CapabilityRegistry {
  private capabilities: Map<string, CapabilityDefinition> = new Map();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaultCapabilities();
    }
  }

  registerCapability(def: CapabilityDefinition): void {
    this.capabilities.set(def.id.toLowerCase(), def);
  }

  unregisterCapability(id: string): boolean {
    return this.capabilities.delete(id.toLowerCase());
  }

  getCapability(id: string): CapabilityDefinition | undefined {
    return this.capabilities.get(id.toLowerCase());
  }

  listCapabilities(category?: CapabilityDefinition['category']): CapabilityDefinition[] {
    const all = Array.from(this.capabilities.values());
    if (!category) return all;
    return all.filter(c => c.category === category);
  }

  hasCapability(id: string): boolean {
    return this.capabilities.has(id.toLowerCase());
  }

  private registerDefaultCapabilities(): void {
    const defaults: CapabilityDefinition[] = [
      { id: 'chat', name: 'Chat Completion', description: 'Supports standard multi-turn conversational messages', category: 'core' },
      { id: 'streaming', name: 'Streaming Response', description: 'Supports real-time token streaming via SSE / AsyncIterable', category: 'core' },
      { id: 'tool_calling', name: 'Tool Calling', description: 'Supports function calling and structured tool execution schemas', category: 'execution' },
      { id: 'function_calling', name: 'Function Calling', description: 'Alias for tool calling schema execution', category: 'execution' },
      { id: 'json', name: 'JSON Mode', description: 'Supports enforcing valid JSON structured output', category: 'format' },
      { id: 'vision', name: 'Vision / Image Input', description: 'Supports multimodal image and visual comprehension', category: 'modality' },
      { id: 'embeddings', name: 'Vector Embeddings', description: 'Supports generating dense numeric vector representations', category: 'modality' },
      { id: 'reasoning', name: 'Advanced Reasoning', description: 'High reasoning capabilities for multi-step planning and CoT', category: 'reasoning' },
      { id: 'coding', name: 'Code Generation', description: 'Specialized in code generation, debugging, and syntax', category: 'reasoning' },
      { id: 'multilingual', name: 'Multilingual', description: 'High proficiency across global languages', category: 'reasoning' },
      { id: 'local', name: 'Local Inference', description: 'Runs locally via Ollama or on-premise hardware without data egress', category: 'tier' },
      { id: 'free', name: 'Free Tier', description: 'Available for free tier usage without budget deduction', category: 'tier' },
      { id: 'enterprise_accurate', name: 'Enterprise Accurate', description: 'Optimized for strict factual adherence and minimal hallucination', category: 'tier' },
    ];

    for (const def of defaults) {
      this.registerCapability(def);
    }
  }
}

export const defaultCapabilityRegistry = new CapabilityRegistry();
