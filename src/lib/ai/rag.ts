/** Simple text embedding via OpenAI; falls back to bag-of-words vector for dev. */

import { fetchWithTimeout } from '@/lib/http';

export async function embedText(text: string, apiKey?: string): Promise<number[]> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (key) {
    const res = await fetchWithTimeout('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.data?.[0]?.embedding as number[];
    }
  }
  return fallbackEmbed(text);
}

export function fallbackEmbed(text: string, dims = 128): number[] {
  const vec = new Array(dims).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) % dims;
    }
    vec[hash] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface RAGChunk {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  score: number;
}

export function rankBySimilarity(
  queryEmbedding: number[],
  docs: Array<{ id: string; title: string; content: string; sourceType: string; embedding: number[] | null }>,
  topK = 5
): RAGChunk[] {
  return docs
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      sourceType: doc.sourceType,
      score: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0,
    }))
    .filter((d) => d.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function buildRAGContext(chunks: RAGChunk[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.content}`)
    .join('\n\n');
}
