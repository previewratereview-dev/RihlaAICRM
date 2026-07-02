export interface OpenAIResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: 'openai';
}

import { fetchWithTimeout } from '@/lib/http';

export async function callOpenAI({
  apiKey,
  model,
  prompt,
  maxTokens = 1024,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
}): Promise<OpenAIResponse> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const usage = data.usage ?? {};
  const tokensIn = Number(usage.prompt_tokens ?? 0);
  const tokensOut = Number(usage.completion_tokens ?? 0);

  return {
    text: choice?.message?.content ?? '',
    tokensIn,
    tokensOut,
    model: data.model ?? model,
    provider: 'openai',
  };
}