export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OpenAIResponse {
  text: string;
  toolCalls?: NormalizedToolCall[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: string;
}

import { fetchWithTimeout } from '@/lib/http';

export async function callOpenAI({
  apiKey,
  model,
  prompt,
  maxTokens = 1024,
  baseUrl,
  timeoutMs,
  tools,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  baseUrl?: string;
  timeoutMs?: number;
  tools?: ProviderToolDefinition[];
}): Promise<OpenAIResponse> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  }, timeoutMs ?? 60000);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const usage = data.usage ?? {};
  const tokensIn = Number(usage.prompt_tokens ?? 0);
  const tokensOut = Number(usage.completion_tokens ?? 0);

  let toolCalls: NormalizedToolCall[] | undefined;
  if (choice?.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
    toolCalls = choice.message.tool_calls.map((tc: { id?: string; function?: { name?: string; arguments?: string } }) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        args = {};
      }
      return {
        id: tc.id || `call_${Date.now()}`,
        name: tc.function?.name || '',
        arguments: args,
      };
    });
  }

  return {
    text: choice?.message?.content ?? '',
    toolCalls,
    tokensIn,
    tokensOut,
    model: data.model ?? model,
    provider: 'openai',
  };
}