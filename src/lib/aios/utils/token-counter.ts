/**
 * StateAI AI Operating System (AIOS) — Token Counter Interface & Utility
 * 
 * Vendor-neutral token estimation and counting interface.
 * Provides fast approximation (~4 chars/token in English) and extensible interface
 * for exact tokenizer integration (tiktoken, etc.) without hard dependencies.
 */

export interface TokenCounter {
  countTokens(text: string, model?: string): number;
  countMessageTokens(messages: Array<{ role: string; content: string }>, model?: string): number;
}

/**
 * Fast approximation token counter (average 4 characters per token for English text).
 * Serverless and edge friendly with zero external bundle dependencies.
 */
export class ApproximateTokenCounter implements TokenCounter {
  countTokens(text: string): number {
    if (!text) return 0;
    // Basic approximation: ~4 characters per token, minimum 1 token for non-empty strings
    return Math.max(1, Math.ceil(text.length / 4));
  }

  countMessageTokens(messages: Array<{ role: string; content: string }>): number {
    if (!messages || messages.length === 0) return 0;
    
    let total = 0;
    for (const msg of messages) {
      // Each message has overhead for role formatting (~4 tokens)
      total += 4;
      total += this.countTokens(msg.content);
    }
    // Add 3 tokens for overall prompt priming
    return total + 3;
  }
}

export const defaultTokenCounter = new ApproximateTokenCounter();
