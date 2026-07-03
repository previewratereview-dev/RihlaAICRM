import { callOpenAI, type OpenAIResponse } from './openai';

export async function callGemini({
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
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  });
}
