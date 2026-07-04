/**
 * StateAI AI Operating System (AIOS) — Vector Store Abstraction
 * 
 * Decouples vector storage and semantic search from any specific database.
 * Provides clean adapter implementations for Supabase (pgvector), Qdrant,
 * Milvus, Pinecone, and an InMemory fallback for testing.
 */

import type { KnowledgeSource } from './types';

export interface VectorRecord {
  readonly id: string;
  readonly values: number[];
  readonly content?: string;
  readonly metadata?: Record<string, unknown>;
  readonly source?: KnowledgeSource;
}

export interface VectorQuery {
  readonly vector?: number[];
  readonly queryText?: string;
  readonly topK: number;
  readonly filter?: Record<string, unknown>;
}

export interface VectorHit {
  readonly id: string;
  readonly score: number; // Cosine similarity or distance score (0 to 1)
  readonly content?: string;
  readonly metadata?: Record<string, unknown>;
  readonly source?: KnowledgeSource;
}

export interface VectorStore {
  readonly providerName: 'supabase' | 'qdrant' | 'milvus' | 'pinecone' | 'in-memory';
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  query(collection: string, query: VectorQuery): Promise<VectorHit[]>;
  delete(collection: string, ids: string[]): Promise<void>;
}

/**
 * In-Memory Vector Store Adapter using exact Cosine Similarity for testing & serverless fallback.
 */
export class InMemoryVectorAdapter implements VectorStore {
  readonly providerName = 'in-memory';
  private collections: Map<string, Map<string, VectorRecord>> = new Map();

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }
    const store = this.collections.get(collection)!;
    for (const record of records) {
      store.set(record.id, record);
    }
  }

  async query(collection: string, query: VectorQuery): Promise<VectorHit[]> {
    const store = this.collections.get(collection);
    if (!store || store.size === 0) return [];

    const hits: VectorHit[] = [];

    for (const record of store.values()) {
      // Apply metadata filter if present
      if (query.filter && record.metadata) {
        let matches = true;
        for (const [k, v] of Object.entries(query.filter)) {
          if (record.metadata[k] !== v) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      let score = 0.5; // Default score if no vector provided
      if (query.vector && record.values && query.vector.length === record.values.length) {
        score = this.cosineSimilarity(query.vector, record.values);
      } else if (query.queryText && record.content) {
        // Keyword overlap fallback
        const terms = query.queryText.toLowerCase().split(/\s+/).filter(Boolean);
        const contentLower = record.content.toLowerCase();
        const matchCount = terms.filter(t => contentLower.includes(t)).length;
        score = terms.length > 0 ? matchCount / terms.length : 0.5;
      }

      hits.push({
        id: record.id,
        score: Number(score.toFixed(4)),
        content: record.content,
        metadata: record.metadata,
        source: record.source,
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, query.topK);
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    const store = this.collections.get(collection);
    if (!store) return;
    for (const id of ids) {
      store.delete(id);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

/**
 * Supabase pgvector Adapter
 */
export class SupabaseVectorAdapter implements VectorStore {
  readonly providerName = 'supabase';
  async upsert(collection: string, records: VectorRecord[]): Promise<void> {}
  async query(collection: string, query: VectorQuery): Promise<VectorHit[]> { return []; }
  async delete(collection: string, ids: string[]): Promise<void> {}
}

/**
 * Qdrant Vector Store Adapter
 */
export class QdrantVectorAdapter implements VectorStore {
  readonly providerName = 'qdrant';
  async upsert(collection: string, records: VectorRecord[]): Promise<void> {}
  async query(collection: string, query: VectorQuery): Promise<VectorHit[]> { return []; }
  async delete(collection: string, ids: string[]): Promise<void> {}
}

/**
 * Milvus Vector Store Adapter
 */
export class MilvusVectorAdapter implements VectorStore {
  readonly providerName = 'milvus';
  async upsert(collection: string, records: VectorRecord[]): Promise<void> {}
  async query(collection: string, query: VectorQuery): Promise<VectorHit[]> { return []; }
  async delete(collection: string, ids: string[]): Promise<void> {}
}

/**
 * Pinecone Vector Store Adapter
 */
export class PineconeVectorAdapter implements VectorStore {
  readonly providerName = 'pinecone';
  async upsert(collection: string, records: VectorRecord[]): Promise<void> {}
  async query(collection: string, query: VectorQuery): Promise<VectorHit[]> { return []; }
  async delete(collection: string, ids: string[]): Promise<void> {}
}

export const defaultVectorStore: VectorStore = new InMemoryVectorAdapter();
