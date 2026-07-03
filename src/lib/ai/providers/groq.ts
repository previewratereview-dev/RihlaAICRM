import { callOpenAI, type OpenAIResponse } from './openai';

export async function callGroq({
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
  return callOpenAI({
    apiKey,
    model,
    prompt,
    maxTokens,
    baseUrl: 'https://api.groq.com/openai/v1',
  });
}
