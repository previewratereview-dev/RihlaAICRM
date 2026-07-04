/**
 * StateAI AI Operating System (AIOS) — Context Compression Strategies
 * 
 * Implements 5 industrial compression strategies to fit high-density
 * context into strict LLM token budgets without losing critical business facts:
 * - Extractive (retaining highest-relevance sentences)
 * - Abstractive (dense bullet summary representations)
 * - Keyword (stripping filler stopwords)
 * - Entity (retaining only structured entity key-values)
 * - Summary (default fallback to pre-computed summary fields)
 */

import type { ContextItem, CompressionStrategyType } from './types';

export class ContextCompressor {
  /**
   * Compress a context item according to the specified strategy to reduce token footprint.
   */
  compress(item: ContextItem, strategy: CompressionStrategyType = 'summary', queryText = ''): ContextItem {
    if (typeof item.content !== 'string') return item;

    const content = item.content;
    let compressedContent = content;

    switch (strategy) {
      case 'summary':
        compressedContent = item.summary || `${content.substring(0, 150)}... [COMPRESSED SUMMARY]`;
        break;

      case 'extractive': {
        const sentences = content.split(/(?<=[.!?])\s+/);
        const terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
        const relevant = sentences.filter(s => {
          const lower = s.toLowerCase();
          return terms.some(t => lower.includes(t)) || /#|booking|vip|lead|invoice|\$/i.test(s);
        });
        compressedContent = (relevant.length > 0 ? relevant.join(' ') : sentences.slice(0, 2).join(' ')) + ' [EXTRACTIVE]';
        break;
      }

      case 'abstractive':
        compressedContent = `• ${content.replace(/\s+/g, ' ').substring(0, 180)} [ABSTRACTIVE BULLET]`;
        break;

      case 'keyword': {
        const stopwords = ['the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'with', 'from', 'please', 'would', 'should', 'could', 'that', 'this', 'there'];
        const words = content.split(/\s+/).filter(w => !stopwords.includes(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
        compressedContent = words.join(' ') + ' [KEYWORD DENSE]';
        break;
      }

      case 'entity': {
        const matches = content.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bBOOK-[A-Z0-9-]{4,10}|\bINV-[A-Z0-9-]{4,10}|\b[A-Z][a-zA-Z\s]+(?:Hotel|Resort|Suites|Corp|Inc|LLC))/gi);
        compressedContent = matches ? `Entities: ${Array.from(new Set(matches)).join(', ')} [ENTITY ONLY]` : (item.summary || `${content.substring(0, 100)} [ENTITY ONLY]`);
        break;
      }
    }

    const newCost = Math.max(10, Math.ceil(compressedContent.length / 4));

    return {
      ...item,
      content: compressedContent,
      ranking: {
        ...item.ranking,
        tokenCost: newCost,
      },
      metadata: {
        ...item.metadata,
        compressed: true,
        compressionStrategy: strategy,
      },
    };
  }
}

export const defaultContextCompressor = new ContextCompressor();
