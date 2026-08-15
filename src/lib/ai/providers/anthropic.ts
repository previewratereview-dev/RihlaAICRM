import type { NormalizedToolCall, ProviderToolDefinition } from './openai';
export type { NormalizedToolCall, ProviderToolDefinition };

export interface AnthropicResponse {
  text: string;
  toolCalls?: NormalizedToolCall[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: 'anthropic';
}

import { fetchWithTimeout } from '@/lib/http';

export async function callAnthropic({
  apiKey,
  model,
  prompt,
  maxTokens = 1024,
  timeoutMs = 60000,
  tools,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: ProviderToolDefinition[];
}): Promise<AnthropicResponse> {
  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const rawContent = Array.isArray(data.content) ? data.content : [];

  const textBlocks = rawContent
    .filter((c: { type: string; text?: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text || '');
  const text = textBlocks.join('\n');

  const toolUseBlocks = rawContent.filter((c: { type: string }) => c.type === 'tool_use');
  let toolCalls: NormalizedToolCall[] | undefined;

  if (toolUseBlocks.length > 0) {
    toolCalls = toolUseBlocks.map((tu: { id?: string; name?: string; input?: Record<string, unknown> }) => ({
      id: tu.id || `toolu_${Date.now()}`,
      name: tu.name || '',
      arguments: tu.input || {},
    }));
  }

  const tokensIn = Number(data.usage?.input_tokens ?? 0);
  const tokensOut = Number(data.usage?.output_tokens ?? 0);

  return {
    text,
    toolCalls,
    tokensIn,
    tokensOut,
    model: data.model ?? model,
    provider: 'anthropic',
  };
}