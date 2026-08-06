'use server';

import { createAI, getMutableAIState, streamUI } from '@ai-sdk/rsc';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { generateId } from 'ai';
import ReactMarkdown from 'react-markdown';

import React from 'react';
import { resolveTenantAIContext } from '@/lib/ai/route-helper';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { SettingsCard } from '@/components/copilot-ui/settings-card';
import { PasswordInput } from '@/components/copilot-ui/password-input';
import { LoginInput } from '@/components/copilot-ui/login-input';
import { PreviewTrigger } from '@/components/copilot-ui/preview-trigger';
import { ProgressTrigger } from '@/components/copilot-ui/progress-trigger';

export interface AIState {
  chatId: string;
  messages: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }[];
}

export type UIState = {
  id: string;
  display: React.ReactNode;
}[];

const SYSTEM_PROMPT = `You are Rihla Setup Assistant, a highly intelligent and conversational AI onboarding guide.
You are aware of all CRM features including Settings & Integrations, Pipeline Management, and Tasks.

Core Directives:
1. Be conversational and intelligent. If the user just says "hi", greet them back naturally and ask how you can help them today. Do NOT force them into the setup flow unless they indicate they want to create a workspace or start setup.
2. If the user wants to create an account/workspace, guide them through setup ONE STEP AT A TIME:
   - Step 1: Ask for their company name.
   - Step 2: Ask for their full name.
   - Step 3: Ask for their email.
   - Step 4: Use the 'askForPassword' tool to let them set a password.
   When they answer a step, use the 'updateProgressAndAsk' tool to silently update the visual tracker AND ask the next question simultaneously.
3. If the user wants to log in, use the 'showLogin' tool immediately.
4. If the user wants to preview the CRM or "try it out", use the 'tryGuestAccess' tool immediately.
5. If the user asks to configure WhatsApp or Email, use the 'configureIntegration' tool.

Respond naturally. Do not sound like a rigid robot. Adapt to the user's input.`;

export async function submitUserMessage(content: string, clientContext?: { isLoggedIn: boolean; firstName?: string; tenantId?: string }) {
  'use server';

  const aiState = getMutableAIState();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  let tenantId = clientContext?.tenantId || 'global';
  let systemPrompt = SYSTEM_PROMPT;
  
  // Check Supabase auth, but fallback to client context if provided (e.g. mock auth)
  const { data: { user } } = await supabase.auth.getUser();
  const isLoggedIn = !!user || !!clientContext?.isLoggedIn;
  
  if (isLoggedIn) {
    let firstName = clientContext?.firstName || 'an authorized user';
    if (user && !clientContext?.firstName) {
      const { data: profile } = await supabase.from('profiles').select('tenant_id, first_name').eq('id', user.id).single();
      if (profile?.tenant_id) {
        tenantId = profile.tenant_id;
        firstName = profile.first_name || firstName;
      }
    }
    systemPrompt += `\n\nCRITICAL CONTEXT: The user is currently LOGGED IN to the application (as ${firstName}). Do NOT offer to create an account, log in, or preview the CRM. Instead, answer their questions or offer to help them navigate the dashboard.`;
  } else {
    systemPrompt += `\n\nCRITICAL CONTEXT: The user is NOT logged in. They are on the public registration/login page. Guide them to preview the CRM, create a workspace, or sign in.`;
  }
  
  const aiContext = await resolveTenantAIContext(supabase, tenantId);

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      { id: generateId(), role: 'user', content },
    ],
  });

  const customProvider = createOpenAI({
    baseURL: aiContext.customBaseUrl || 'https://api.openai.com/v1',
    apiKey: aiContext.customApiKey || process.env.OPENAI_API_KEY || '',
  });

  const streamOptions = {
    system: systemPrompt + '\n\nContext:\n' + JSON.stringify(aiContext),
    messages: aiState.get().messages.map((m: AIState['messages'][0]) => ({
      role: m.role,
      content: m.content,
    })),
    text: ({ content, done }: { content: string, done: boolean }) => {
      if (done) {
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            { id: generateId(), role: 'assistant' as const, content },
          ],
        });
      }
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold">
          <ReactMarkdown>
            {content}
          </ReactMarkdown>
        </div>
      );
    },
    tools: {
      configureIntegration: {
        description: 'Show the configuration card for an integration like whatsapp or email.',
        inputSchema: z.object({
          integrationName: z.string().describe('The name of the integration (e.g. whatsapp, email)'),
        }),
        generate: async ({ integrationName }: { integrationName: string }) => {
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: generateId(),
                role: 'assistant' as const,
                content: `Showing settings card for ${integrationName}`,
              },
            ],
          });
          return <SettingsCard integration={integrationName} />;
        },
      },
      updateProgressAndAsk: {
        description: 'Update the visual progress tracker AND ask the next question. Use this when the user completes a setup step.',
        inputSchema: z.object({
          step: z.enum(['welcome', 'company', 'team', 'preferences', 'complete']),
          nextQuestion: z.string().describe('The natural conversational text asking the next question.'),
        }),
        generate: async ({ step, nextQuestion }: { step: 'welcome' | 'company' | 'team' | 'preferences' | 'complete', nextQuestion: string }) => {
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: generateId(),
                role: 'assistant' as const,
                content: nextQuestion,
              },
            ],
          });
          return (
            <div className="flex flex-col gap-2">
              <ProgressTrigger step={step} />
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed">
                <ReactMarkdown>{nextQuestion}</ReactMarkdown>
              </div>
            </div>
          );
        }
      },
      askForPassword: {
        description: 'Show a secure password input field to complete user registration.',
        inputSchema: z.object({
          email: z.string(),
          fullName: z.string(),
          agencyName: z.string(),
        }),
        generate: async ({ email, fullName, agencyName }: { email: string, fullName: string, agencyName: string }) => {
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: generateId(),
                role: 'assistant' as const,
                content: `Waiting for user to set password for ${email}`,
              },
            ],
          });
          return <PasswordInput email={email} fullName={fullName} agencyName={agencyName} />;
        },
      },
      showLogin: {
        description: 'Provide the user with a login interface so they can log into their existing account.',
        inputSchema: z.object({}),
        generate: async () => {
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: generateId(),
                role: 'assistant' as const,
                content: `Showing the secure login interface.`,
              },
            ],
          });
          return <LoginInput />;
        },
      },
      tryGuestAccess: {
        description: 'Trigger the Guest Preview mode so the user can try the CRM without logging in.',
        inputSchema: z.object({}),
        generate: async () => {
          aiState.done({
            ...aiState.get(),
            messages: [
              ...aiState.get().messages,
              {
                id: generateId(),
                role: 'assistant' as const,
                content: `Triggered the CRM guest preview mode.`,
              },
            ],
          });
          return <PreviewTrigger />;
        },
      },
    },
  };

  // Use .chat() to force the Chat Completions API (/chat/completions) instead of the
  // Responses API (/responses). The Responses API is OpenAI-only; all OpenAI-compatible
  // providers (Groq, NVIDIA NIM, Z.ai, OpenRouter, Ollama, etc.) only expose
  // /chat/completions. Using the default provider function would hit /responses and
  // return a 404 "Not Found" on every non-OpenAI endpoint.
  let uiStream;
  try {
    uiStream = await streamUI({
      model: customProvider.chat(aiContext.defaultModel || 'gpt-4o-mini'),
      ...streamOptions,
    });
  } catch (error) {
    const primaryErrorMessage = error instanceof Error ? error.message : String(error);
    const configuredBaseUrl = aiContext.customBaseUrl || 'https://api.openai.com/v1';
    console.warn(`Custom AI provider (${configuredBaseUrl}) failed:`, primaryErrorMessage);

    // Only attempt the OpenAI fallback if a server-side OpenAI key is actually configured.
    // Without a key, the fallback would always fail and mask the real provider error.
    const hasOpenAiFallback = !!process.env.OPENAI_API_KEY;
    if (hasOpenAiFallback) {
      try {
        const fallbackProvider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
        uiStream = await streamUI({
          model: fallbackProvider.chat('gpt-4o-mini'),
          ...streamOptions,
        });
      } catch (fallbackError) {
        console.error('OpenAI fallback also failed:', fallbackError);
        return {
          id: generateId(),
          display: (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed text-destructive">
              <ReactMarkdown>
                {`**AI Configuration Error:** The primary AI provider rejected the request.\n\n**Endpoint:** \`${configuredBaseUrl}\`\n**Model:** \`${aiContext.defaultModel || 'gpt-4o-mini'}\`\n**Error:** \`${primaryErrorMessage}\`\n\nThe OpenAI fallback was also unavailable. Please verify your model supports tool calling and check your API key / Base URL in **Super Admin → Platform Settings**.`}
              </ReactMarkdown>
            </div>
          ),
        };
      }
    } else {
      // No OpenAI fallback key configured — surface the real provider error directly.
      return {
        id: generateId(),
        display: (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed text-destructive">
            <ReactMarkdown>
              {`**AI Configuration Error:** The configured AI provider rejected the request.\n\n**Endpoint:** \`${configuredBaseUrl}\`\n**Model:** \`${aiContext.defaultModel || 'gpt-4o-mini'}\`\n**Error:** \`${primaryErrorMessage}\`\n\nPlease verify your model supports tool calling and check your API key / Base URL in **Super Admin → Platform Settings**.`}
            </ReactMarkdown>
          </div>
        ),
      };
    }
  }

  return {
    id: generateId(),
    display: uiStream.value,
  };
}

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage,
  },
  initialUIState: [
    {
      id: generateId(),
      display: (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold">
          <ReactMarkdown>
            {`Welcome to Rihla. I'll help you set up your CRM in about 2 minutes.`}
          </ReactMarkdown>
        </div>
      ),
    }
  ],
  initialAIState: { 
    chatId: generateId(), 
    messages: [
      {
        id: generateId(),
        role: 'assistant',
        content: "Welcome to Rihla. I'll help you set up your CRM in about 2 minutes."
      }
    ] 
  },
});