/**
 * StateAI AI Operating System (AIOS) — RAG Interface Package
 * 
 * Defines the contract for Retrieval-Augmented Generation indexing and vector querying.
 */

export interface RAGDocument {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly tenantId: string;
}

export interface RAG {
  indexDocument(docId: string, content: string, metadata: Record<string, unknown>, tenantId: string): Promise<void>;
  queryRelevantContext(query: string, topK: number, tenantId: string): Promise<string[]>;
}
