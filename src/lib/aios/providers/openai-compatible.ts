/**
 * StateAI AI Operating System (AIOS) — OpenAI Compatible Provider Adapter
 * 
 * Unified provider adapter supporting OpenAI, NVIDIA Foundation Models,
 * GLM / Zhipu AI, and Local Ollama through configuration only.
 * 
 * STRICT RULE: No OpenAI SDK dependencies. Uses native fetch and vendor-neutral types.
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
} from '../types';
import { normalizeProviderError, ProviderConfigurationError } from '../errors';
import { withTimeout, withRetry, defaultTokenCounter, enrichUsageWithCost } from '../utils';
import { defaultModelRegistry } from '../models';

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  supportedModels?: string[];
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private apiKey?: string;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private supportedModels: string[];

  // Health tracking state
  private totalRequests = 0;
  private successfulRequests = 0;
  private lastSuccessfulRequest?: Date;
  private lastFailure?: Date;
  private lastErrorMessage?: string;
  private lastLatencyMs?: number;
  private modelAvailability: Record<string, boolean> = {};

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id.toLowerCase();
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.defaultHeaders = config.defaultHeaders || {};
    this.supportedModels = config.supportedModels || [];
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      supportsEmbeddings: true,
      supportsVision: true,
      supportedModels: this.supportedModels.length > 0 
        ? this.supportedModels 
        : defaultModelRegistry.getModelsByProvider(this.id).map(m => m.id),
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
      // Execute a minimal models endpoint check or lightweight request
      const url = `${this.baseUrl}/models`;
      const res = await withTimeout(
        async (signal) => fetch(url, {
          method: 'GET',
          headers: this.getHeaders(),
          signal,
        }),
        { timeoutMs: 10000, provider: this.id }
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'Unknown error')}`);
      }

      const data = await res.json().catch(() => ({ data: [] }));
      if (Array.isArray(data.data)) {
        for (const m of data.data) {
          if (m && typeof m.id === 'string') {
            this.modelAvailability[m.id] = true;
          }
        }
      }

      this.recordSuccess(Date.now() - start);
    } catch (err) {
      this.recordFailure(err, Date.now() - start);
    }
    return this.getHealth();
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const start = Date.now();
    const url = `${this.baseUrl}/chat/completions`;
    const apiKey = options.apiKey || this.apiKey;

    if (!apiKey && this.id !== 'ollama') {
      throw new ProviderConfigurationError(this.id, 'API key is missing and required for completion');
    }

    const payload = this.formatCompletionPayload(options, false);

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
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('No choices returned in OpenAI compatible response');
      }

      const text = choice.message?.content || '';
      const rawToolCalls = choice.message?.tool_calls;
      const toolCalls = this.parseToolCalls(rawToolCalls);
      const finishReason = this.mapFinishReason(choice.finish_reason);

      const tokensIn = Number(data.usage?.prompt_tokens ?? defaultTokenCounter.countMessageTokens(options.messages, options.model));
      const tokensOut = Number(data.usage?.completion_tokens ?? defaultTokenCounter.countTokens(text));
      
      const modelInfo = defaultModelRegistry.getModel(data.model || options.model);
      const usage = enrichUsageWithCost({ tokensIn, tokensOut }, modelInfo?.costMetadata);

      this.recordSuccess(Date.now() - start, data.model || options.model);

      return {
        text,
        toolCalls,
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
    const url = `${this.baseUrl}/chat/completions`;
    const apiKey = options.apiKey || this.apiKey;

    if (!apiKey && this.id !== 'ollama') {
      throw new ProviderConfigurationError(this.id, 'API key is missing and required for streaming');
    }

    const payload = this.formatCompletionPayload(options, true);

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

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              break;
            }

            try {
              const chunkData = JSON.parse(dataStr);
              if (chunkData.model) modelName = chunkData.model;
              const delta = chunkData.choices?.[0]?.delta;
              const finishReasonRaw = chunkData.choices?.[0]?.finish_reason;

              if (chunkData.usage) {
                totalTokensIn = Number(chunkData.usage.prompt_tokens ?? totalTokensIn);
                totalTokensOut = Number(chunkData.usage.completion_tokens ?? totalTokensOut);
              }

              if (delta) {
                const textDelta = delta.content || undefined;
                if (textDelta) {
                  totalTokensOut += defaultTokenCounter.countTokens(textDelta);
                }

                let toolCallDelta: StreamingChunk['toolCallDelta'];
                if (delta.tool_calls && delta.tool_calls.length > 0) {
                  const tc = delta.tool_calls[0];
                  toolCallDelta = {
                    id: tc.id || undefined,
                    name: tc.function?.name || undefined,
                    argumentsDelta: tc.function?.arguments || undefined,
                  };
                }

                const finishReason = finishReasonRaw ? this.mapFinishReason(finishReasonRaw) : undefined;

                yield {
                  textDelta,
                  toolCallDelta,
                  finishReason,
                  provider: this.id,
                  model: modelName,
                };
              }
            } catch {
              // Ignore malformed JSON chunks in SSE stream
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const modelInfo = defaultModelRegistry.getModel(modelName);
      const usage = enrichUsageWithCost({ tokensIn: totalTokensIn, tokensOut: totalTokensOut }, modelInfo?.costMetadata);

      this.recordSuccess(Date.now() - start, modelName);

      // Final closing chunk with total usage
      yield {
        finishReason: 'stop',
        usage,
        provider: this.id,
        model: modelName,
      };
    } catch (err) {
      this.recordFailure(err, Date.now() - start, options.model);
      throw normalizeProviderError(this.id, err);
    }
  }

  async embed(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    const start = Date.now();
    const url = `${this.baseUrl}/embeddings`;
    const apiKey = options.apiKey || this.apiKey;

    if (!apiKey && this.id !== 'ollama') {
      throw new ProviderConfigurationError(this.id, 'API key is missing and required for embeddings');
    }

    const payload = {
      model: options.model,
      input: options.input,
      dimensions: options.dimensions,
    };

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
      const embeddings = (data.data || []).map((d: { embedding: number[] }) => d.embedding);
      const tokensIn = Number(data.usage?.prompt_tokens ?? 0);

      this.recordSuccess(Date.now() - start, options.model);

      return {
        embeddings,
        usage: {
          tokensIn,
          totalTokens: tokensIn,
        },
        provider: this.id,
        model: data.model || options.model,
      };
    } catch (err) {
      this.recordFailure(err, Date.now() - start, options.model);
      throw normalizeProviderError(this.id, err);
    }
  }

  private getHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
    };
    const key = apiKey || this.apiKey;
    if (key && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${key}`;
    }
    return headers;
  }

  private formatCompletionPayload(options: CompletionOptions, stream: boolean): Record<string, unknown> {
    const messages = options.messages.map(m => {
      const formatted: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      };
      if (m.name) formatted.name = m.name;
      if (m.toolCallId) formatted.tool_call_id = m.toolCallId;
      if (m.toolCalls && m.toolCalls.length > 0) {
        formatted.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
      return formatted;
    });

    const payload: Record<string, unknown> = {
      model: options.model,
      messages,
      stream,
    };

    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;
    if (options.topP !== undefined) payload.top_p = options.topP;
    if (options.stopSequences && options.stopSequences.length > 0) payload.stop = options.stopSequences;
    if (options.jsonMode) payload.response_format = { type: 'json_object' };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    if (stream && this.id !== 'ollama') {
      payload.stream_options = { include_usage: true };
    }

    return payload;
  }

  private parseToolCalls(raw: unknown): ToolCall[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const calls: ToolCall[] = [];
    for (const item of raw) {
      if (item && item.type === 'function' && item.function) {
        let args = {};
        try {
          args = typeof item.function.arguments === 'string' 
            ? JSON.parse(item.function.arguments) 
            : item.function.arguments || {};
        } catch {
          // If JSON parse fails, keep empty object or raw string
          args = { raw: item.function.arguments };
        }
        calls.push({
          id: String(item.id || `call_${Math.random().toString(36).substring(2, 9)}`),
          name: String(item.function.name),
          arguments: args as Record<string, unknown>,
        });
      }
    }
    return calls.length > 0 ? calls : undefined;
  }

  private mapFinishReason(reason: unknown): FinishReason {
    if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls';
    if (reason === 'length' || reason === 'max_tokens') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    if (reason === 'error' || reason === 'failed') return 'error';
    return 'stop';
  }

  private recordSuccess(latencyMs: number, model?: string): void {
    this.totalRequests++;
    this.successfulRequests++;
    this.lastSuccessfulRequest = new Date();
    this.lastLatencyMs = latencyMs;
    if (model) this.modelAvailability[model] = true;
  }

  private recordFailure(error: unknown, latencyMs: number, model?: string): void {
    this.totalRequests++;
    this.lastFailure = new Date();
    this.lastLatencyMs = latencyMs;
    this.lastErrorMessage = error instanceof Error ? error.message : String(error);
    if (model) this.modelAvailability[model] = false;
  }
}
