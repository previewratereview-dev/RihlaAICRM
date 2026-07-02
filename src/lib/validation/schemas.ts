import { z } from 'zod';

// =====================================================================
// Shared request validation schemas for API routes.
// =====================================================================

// --- Billing ---
export const VerifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1).max(255),
  razorpay_payment_id: z.string().min(1).max(255),
  razorpay_signature: z.string().min(1).max(512),
  plan: z.enum(['monthly', 'yearly', 'lifetime']),
});

export const CreateOrderSchema = z.object({
  plan: z.enum(['monthly', 'yearly', 'lifetime']),
});

// --- Auth ---
export const VerifyOtpSchema = z.object({
  email: z.string().email().max(320),
  token: z.string().length(6).regex(/^\d{6}$/),
});

export const ResendOtpSchema = z.object({
  email: z.string().email().max(320),
});

export const RegisterSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(200),
  agencyName: z.string().min(1).max(200),
});

// --- Messaging ---
export const SendMessageSchema = z.object({
  conversationId: z.string().min(1).max(255),
  content: z.string().min(1).max(5000),
  senderId: z.string().uuid(),
  senderName: z.string().min(1).max(200),
});

// --- AI ---
export const AICompleteSchema = z.object({
  prompt: z.string().min(1).max(10000),
  maxTokens: z.number().int().min(1).max(4000).optional(),
});

export const AIConversationSchema = z.object({
  action: z.enum(['summarize', 'suggest_replies', 'lead_summary']),
  conversationId: z.string().min(1).max(255).optional(),
  leadId: z.string().min(1).max(255).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(10000),
  })).max(50).optional(),
});

export const AICopilotSchema = z.object({
  message: z.string().min(1).max(10000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const AIEmbedSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  sourceType: z.string().min(1).max(100),
  sourceUrl: z.string().url().max(1024).optional(),
});

export const AILeadActionSchema = z.object({
  action: z.enum(['draft_email', 'next_action', 'meeting_prep', 'contact_reply']),
  leadContext: z.string().min(1).max(20000),
  extra: z.string().max(10000).optional(),
});

export const AIUsageSchema = z.object({
  feature: z.string().min(1).max(100),
  provider: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  tokensIn: z.number().int().min(0).optional(),
  tokensOut: z.number().int().min(0).optional(),
  costEstimate: z.number().min(0).max(100).optional(),
  status: z.enum(['success', 'error', 'timeout']).optional(),
  requestId: z.string().max(255).optional(),
});

// --- FAQ ---
export const FAQUpsertSchema = z.object({
  faqs: z.array(z.object({
    id: z.string().optional(),
    question: z.string().min(1).max(1000),
    answer: z.string().min(1).max(5000),
    category: z.string().max(200).optional(),
    keywords: z.array(z.string()).optional(),
  })).min(1).max(100),
});

// --- Workflows ---
export const WorkflowUpsertSchema = z.object({
  rules: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(200),
    enabled: z.boolean().optional(),
    triggerType: z.string().min(1).max(200),
    conditions: z.array(z.record(z.string(), z.unknown())).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
  })).min(1).max(50),
});

// --- Tenant ---
export const TenantKeysSchema = z.object({
  openai_key: z.string().max(512).optional().nullable(),
  anthropic_key: z.string().max(512).optional().nullable(),
  make_webhook_url: z.string().url().max(1024).optional().nullable(),
});

export const TenantBrandingSchema = z.object({
  agency_name: z.string().min(1).max(200).optional(),
  logo_text: z.string().max(100).optional(),
  accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  logo_url: z.string().url().max(1024).optional().nullable(),
});

// --- Generic validation helper ---
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: true;
  data: T;
} | {
  success: false;
  errors: string[];
} {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}
