/**
 * StateAI AI Operating System (AIOS) — Knowledge Engine Types
 * 
 * Defines authoritative contracts for:
 * - Domain-separated knowledge (Internal vs External)
 * - Multimodal knowledge reservations (PDFs, Images, Voice, Video, CAD, Medical Scans)
 * - Trust Scoring (source reliability, verification status, recency, confidence)
 * - Immutable Citation ID generation (KNOW-xxxx, DOC-xxxx, etc.)
 * - Query rewriting, multi-query retrieval variations, vector storage, and reranking.
 */

export type KnowledgeDomain = 'internal' | 'external';

export type InternalKnowledgeCategory = 'sop' | 'crm_record' | 'policy' | 'document';
export type ExternalKnowledgeCategory =
  | 'web'
  | 'api'
  | 'weather'
  | 'maps'
  | 'flight_prices'
  | 'exchange_rates'
  | 'government_data';

export type MultimodalContentType =
  | 'text'
  | 'pdf'
  | 'image'
  | 'voice'
  | 'video'
  | 'cad_drawing'
  | 'medical_scan';

export interface MultimodalContent {
  readonly type: MultimodalContentType;
  readonly uri: string;
  readonly mimeType?: string;
  readonly extractedText?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface TrustScore {
  readonly sourceReliability: number; // 0 to 1 (e.g., official SharePoint vs web scrape)
  readonly verificationStatus: 'verified' | 'unverified' | 'disputed' | 'official';
  readonly recencyScore: number;      // 0 to 1 (decay based on age)
  readonly confidence: number;        // 0 to 1 (extraction or embedding accuracy)
  readonly overallTrust: number;      // Composite weighted trust score (0 to 1)
}

export interface KnowledgeFreshness {
  readonly created: Date;
  readonly updated: Date;
  readonly expires?: Date;
  readonly verified: Date;
  readonly isExpired?: boolean;
}

export interface KnowledgeSource {
  readonly id: string;
  readonly citationId: string;        // Immutable citation ID (e.g., KNOW-8472, DOC-1092)
  readonly uri: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly confidence: number;
  readonly version: string;
  readonly domain?: KnowledgeDomain;
  readonly category?: InternalKnowledgeCategory | ExternalKnowledgeCategory;
  readonly multimodal?: MultimodalContent[];
  readonly trust?: TrustScore;
  readonly freshness: KnowledgeFreshness;
  readonly metadata: Record<string, unknown>;
}

export interface QueryRewriteResult {
  readonly originalQuery: string;
  readonly rewrittenQuery: string;
  readonly filters: Record<string, unknown>;
  readonly keywords: string[];
}

export type QueryVariationType =
  | 'original'
  | 'synonym'
  | 'semantic'
  | 'keyword'
  | 'abbreviation';

export interface MultiQueryVariation {
  readonly type: QueryVariationType;
  readonly query: string;
  readonly weight: number;
}

export interface RerankerHit {
  readonly id: string;
  readonly citationId: string;
  readonly content: string;
  readonly score: number;
  readonly originalScore: number;
  readonly source?: KnowledgeSource;
  readonly trust?: TrustScore;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Generate an immutable, human-readable citation ID for reliable planner referencing.
 */
export function generateCitationId(
  prefix: 'KNOW' | 'MEM' | 'DOC' | 'CRM' | 'TOOL' | 'WEB' | 'POL',
  rawId?: string
): string {
  if (rawId && /^([A-Z]{3,4})-\d{4,6}$/.test(rawId)) {
    return rawId;
  }
  const hash = rawId
    ? Math.abs(rawId.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)) % 9000 + 1000
    : Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${hash}`;
}
