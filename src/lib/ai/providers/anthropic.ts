export interface AnthropicResponse {
  text: string;
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
}: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<AnthropicResponse> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, timeoutMs);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const content = data.content?.[0];
  const tokensIn = Number(data.usage?.input_tokens ?? 0);
  const tokensOut = Number(data.usage?.output_tokens ?? 0);

  return {
    text: content?.text ?? '',
    tokensIn,
    tokensOut,
    model: data.model ?? model,
    provider: 'anthropic',
  };
}