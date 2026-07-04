/**
 * StateAI AI Operating System (AIOS) — Anthropic Provider Adapter
 * 
 * Dedicated adapter translating unified AIOS messages, system prompts,
 * tool schemas, and tool results into Anthropic's native format internally.
 * 
 * STRICT RULE: No Anthropic SDK types outside this adapter.
 */

import type {
  LLMProvider,
  CompletionOptions,
  CompletionResponse,
  StreamingChunk,
  EmbeddingOptions,
  EmbeddingResponse,
  ProviderCapabilities,
  ProviderHealth,
  ToolDefinition,
  ToolCall,
  FinishReason,
  Message,
} from '../types';
import { normalizeProviderError, ProviderConfigurationError, InvalidModelError } from '../errors';
import { withTimeout, withRetry, defaultTokenCounter, enrichUsageWithCost } from '../utils';
import { defaultModelRegistry } from '../models';

export interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  supportedModels?: string[];
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  private apiKey?: string;
  private baseUrl: string;
  private apiVersion: string;
  private supportedModels: string[];

  // Health tracking state
  private totalRequests = 0;
  private successfulRequests = 0;
  private lastSuccessfulRequest?: Date;
  private lastFailure?: Date;
  private lastErrorMessage?: string;
  private lastLatencyMs?: number;
  private modelAvailability: Record<string, boolean> = {};

  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = (config.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiVersion = config.apiVersion || '2023-06-01';
    this.supportedModels = config.supportedModels || [
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307',
      'claude-3-opus-20240229',
    ];
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      supportsEmbeddings: false, // Anthropic does not provide native embeddings
      supportsVision: true,
      supportedModels: this.supportedModels,
    };
  }

  getHealth(): ProviderHealth {
    const availabilityPercentage = this.totalRequests === 0 
      ? 100 
      : Math.round((this.successfulRequests / this.totalRequests) * 100);

    let status: ProviderHealth['status'] = 'healthy';
    if (this.totalRequests === 0) status = 'unknown';
    else if (availabilityPercentage < 50) status = 'unhealthy';
    else if (availabilityPercentage < 95) status = 'degraded';

    return {
      status,
      latencyMs: this.lastLatencyMs,
      lastSuccessfulRequest: this.lastSuccessfulRequest,
      lastFailure: this.lastFailure,
      lastErrorMessage: this.lastErrorMessage,
      availabilityPercentage,
      modelAvailability: { ...this.modelAvailability },
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      if (!this.apiKey) {
        throw new ProviderConfigurationError(this.id, 'API key missing');
      }
      // Send a lightweight 1-token request to verify API key and endpoint
      const url = `${this.baseUrl}/v1/messages`;
      const res = await withTimeout(
        async (signal) => fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal,
        }),
        { timeoutMs: 10000, provider: this.id }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      this.recordSuccess(Date.now() - start, 'claude-3-haiku-20240307');
    } catch (err) {
      this.recordFailure(err, Date.now() - start);
    }
    return this.getHealth();
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const start = Date.now();
    const url = `${this.baseUrl}/v1/messages`;
    const apiKey = options.apiKey || this.apiKey;

    if (!apiKey) {
      throw new ProviderConfigurationError(this.id, 'API key is missing and required for Anthropic completion');
    }

    const payload = this.formatAnthropicPayload(options, false);

    try {
      const res = await withRetry(
        async () => {
          return await withTimeout(
            async (signal) => fetch(url, {
              method: 'POST',
              headers: this.getHeaders(apiKey),
              body: JSON.stringify(payload),
              signal,
            }),
            { timeoutMs: options.timeoutMs || 30000, provider: this.id }
          );
        },
        { maxRetries: options.maxRetries ?? 2 }
      );

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown HTTP error');
        throw normalizeProviderError(this.id, { status: res.status, message: errorText });
      }

      const data = await res.json();
      
      let text = '';
      const toolCalls: ToolCall[] = [];

      if (Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'text') {
            text += block.text || '';
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: String(block.id),
              name: String(block.name),
              arguments: (block.input || {}) as Record<string, unknown>,
            });
          }
        }
      }

      const finishReason = this.mapFinishReason(data.stop_reason);
      const tokensIn = Number(data.usage?.input_tokens ?? defaultTokenCounter.countMessageTokens(options.messages, options.model));
      const tokensOut = Number(data.usage?.output_tokens ?? defaultTokenCounter.countTokens(text));

      const modelInfo = defaultModelRegistry.getModel(data.model || options.model);
      const usage = enrichUsageWithCost({ tokensIn, tokensOut }, modelInfo?.costMetadata);

      this.recordSuccess(Date.now() - start, data.model || options.model);

      return {
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason,
        usage,
        provider: this.id,
        model: data.model || options.model,
        rawResponse: data,
      };
    } catch (err) {
      this.recordFailure(err, Date.now() - start, options.model);
      throw normalizeProviderError(this.id, err);
    }
  }

  async *stream(options: CompletionOptions): AsyncIterable<StreamingChunk> {
    const start = Date.now();
    const url = `${this.baseUrl}/v1/messages`;
    const apiKey = options.apiKey || this.apiKey;

    if (!apiKey) {
      throw new ProviderConfigurationError(this.id, 'API key is missing and required for Anthropic streaming');
    }

    const payload = this.formatAnthropicPayload(options, true);

    try {
      const res = await withTimeout(
        async (signal) => fetch(url, {
          method: 'POST',
          headers: this.getHeaders(apiKey),
          body: JSON.stringify(payload),
          signal,
        }),
        { timeoutMs: options.timeoutMs || 60000, provider: this.id }
      );

      if (!res.ok || !res.body) {
        const errorText = await res.text().catch(() => 'Unknown HTTP error');
        throw normalizeProviderError(this.id, { status: res.status, message: errorText });
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let totalTokensIn = defaultTokenCounter.countMessageTokens(options.messages, options.model);
      let totalTokensOut = 0;
      let modelName = options.model;
      let stopReasonRaw: unknown;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]' || dataStr === '') continue;

            try {
              const event = JSON.parse(dataStr);
              
              if (event.type === 'message_start' && event.message) {
                if (event.message.model) modelName = event.message.model;
                if (event.message.usage?.input_tokens) {
                  totalTokensIn = Number(event.message.usage.input_tokens);
                }
              }

              if (event.type === 'content_block_start' && event.content_block) {
                if (event.content_block.type === 'tool_use') {
                  yield {
                    toolCallDelta: {
                      id: event.content_block.id,
                      name: event.content_block.name,
                      argumentsDelta: '',
                    },
                    provider: this.id,
                    model: modelName,
                  };
                }
              }

              if (event.type === 'content_block_delta' && event.delta) {
                if (event.delta.type === 'text_delta' && event.delta.text) {
                  totalTokensOut += defaultTokenCounter.countTokens(event.delta.text);
                  yield {
                    textDelta: event.delta.text,
                    provider: this.id,
                    model: modelName,
                  };
                } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                  yield {
                    toolCallDelta: {
                      argumentsDelta: event.delta.partial_json,
                    },
                    provider: this.id,
                    model: modelName,
                  };
                }
              }

              if (event.type === 'message_delta' && event.delta) {
                if (event.delta.stop_reason) {
                  stopReasonRaw = event.delta.stop_reason;
                }
                if (event.usage?.output_tokens) {
                  totalTokensOut = Number(event.usage.output_tokens);
                }
              }
            } catch {
              // Ignore malformed JSON chunks
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const modelInfo = defaultModelRegistry.getModel(modelName);
      const usage = enrichUsageWithCost({ tokensIn: totalTokensIn, tokensOut: totalTokensOut }, modelInfo?.costMetadata);
      const finishReason = this.mapFinishReason(stopReasonRaw);

      this.recordSuccess(Date.now() - start, modelName);

      yield {
        finishReason,
        usage,
        provider: this.id,
        model: modelName,
      };
    } catch (err) {
      this.recordFailure(err, Date.now() - start, options.model);
      throw normalizeProviderError(this.id, err);
    }
  }

  async embed(): Promise<EmbeddingResponse> {
    throw new InvalidModelError(this.id, 'embeddings_not_supported_by_anthropic');
  }

  private getHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.apiVersion,
    };
    const key = apiKey || this.apiKey;
    if (key) {
      headers['x-api-key'] = key;
    }
    return headers;
  }

  /**
   * Translates AIOS messages, system prompt, and tools into Anthropic format.
   * Anthropic requires:
   * 1. Top-level `system` parameter (not role: 'system' in messages array).
   * 2. Strict alternating user/assistant roles.
   * 3. Tool results formatted as role: 'user' with content block: { type: 'tool_result', tool_use_id, content }.
   */
  private formatAnthropicPayload(options: CompletionOptions, stream: boolean): Record<string, unknown> {
    const systemMessages: string[] = [];
    const anthropicMessages: Array<{ role: string; content: unknown }> = [];

    for (const msg of options.messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
        continue;
      }

      if (msg.role === 'tool') {
        // Translate tool execution result into Anthropic's tool_result content block inside a user message
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || 'unknown_tool_id',
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const contentBlocks: Array<Record<string, unknown>> = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthropicMessages.push({
          role: 'assistant',
          content: contentBlocks.length > 0 ? contentBlocks : msg.content || '',
        });
        continue;
      }

      // Default user message
      anthropicMessages.push({
        role: 'user',
        content: msg.content,
      });
    }

    const payload: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens || 1024,
      messages: anthropicMessages,
      stream,
    };

    if (systemMessages.length > 0) {
      payload.system = systemMessages.join('\n\n');
    }

    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.stopSequences && options.stopSequences.length > 0) payload.stop_sequences = options.stopSequences;

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return payload;
  }

  private mapFinishReason(reason: unknown): FinishReason {
    if (reason === 'tool_use') return 'tool_calls';
    if (reason === 'max_tokens') return 'length';
    if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
    return 'stop';
  }
}
