/**
 * StateAI AI Operating System (AIOS) — Memory Engine Interface
 * 
 * Authoritative contracts for Milestone 3B:
 * - 7-Layer Memory Architecture (Working, Conversation, Semantic, Episodic, Entity, Knowledge Graph, Relationship Graph)
 * - Strict separation of Entity Graph (instances: Customer -> Booking -> Hotel -> Invoice)
 *   and Knowledge Graph (concepts/rules: Booking Policy -> Cancellation Rule -> Refund Policy)
 * - Active Memory Event emitting (memory.created, memory.updated, memory.expired, etc.)
 */

import type { AIExecutionContext } from '../types';
import type { TrustScore } from '../knowledge/types';

export type MemoryType =
  | 'working'
  | 'conversation'
  | 'semantic'
  | 'episodic'
  | 'entity'
  | 'knowledge_graph'
  | 'relationship_graph';

export type MemoryEventType =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.expired'
  | 'memory.consolidated'
  | 'memory.retrieved';

export interface MemoryEventPayload {
  readonly eventType: MemoryEventType;
  readonly memoryId: string;
  readonly citationId: string;
  readonly memoryType: MemoryType;
  readonly tenantId: string;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Entity Graph: represents instances and records (e.g., Customer -> Booking -> Hotel -> Invoice).
 */
export interface EntityGraphNode {
  readonly id: string;
  readonly citationId: string;
  readonly entityType: 'customer' | 'booking' | 'hotel' | 'company' | 'invoice' | 'employee' | 'other';
  readonly label: string;
  readonly attributes: Record<string, unknown>;
  readonly trust?: TrustScore;
}

export interface EntityGraphEdge {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly relationship: string; // e.g., 'BOOKED_BY', 'STAYING_AT', 'BILLED_TO'
  readonly weight: number;
}

/**
 * Knowledge Graph: represents conceptual domains and policies (e.g., Booking Policy -> Cancellation Rule -> Refund Policy).
 */
export interface KnowledgeGraphNode {
  readonly id: string;
  readonly citationId: string;
  readonly conceptType: 'policy' | 'rule' | 'procedure' | 'regulation' | 'guideline';
  readonly title: string;
  readonly ruleContent: string;
  readonly trust?: TrustScore;
}

export interface KnowledgeGraphEdge {
  readonly sourceConceptId: string;
  readonly targetConceptId: string;
  readonly relationship: string; // e.g., 'GOVERNS', 'REQUIRES', 'EXCEPT_WHEN', 'OVERRIDES'
  readonly priority: number;
}

export interface MemoryRecord {
  readonly id: string;
  readonly citationId: string;
  readonly type: MemoryType;
  readonly content: unknown;
  readonly summary?: string;
  readonly confidence: number;
  readonly trust?: TrustScore;
  readonly timestamp: Date;
  readonly expiresAt?: Date;
  readonly metadata: Record<string, unknown>;
}

export interface MemoryEngine {
  readonly id: string;
  readonly name: string;
  store(record: Omit<MemoryRecord, 'id' | 'citationId' | 'timestamp'>, context: AIExecutionContext): Promise<MemoryRecord>;
  retrieve(id: string, context: AIExecutionContext): Promise<MemoryRecord | null>;
  search(query: string, types: MemoryType[], limit: number, context: AIExecutionContext): Promise<MemoryRecord[]>;
  traverseEntityGraph(startNodeId: string, depth: number, context: AIExecutionContext): Promise<{ nodes: EntityGraphNode[]; edges: EntityGraphEdge[] }>;
  traverseKnowledgeGraph(startConceptId: string, depth: number, context: AIExecutionContext): Promise<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }>;
}
