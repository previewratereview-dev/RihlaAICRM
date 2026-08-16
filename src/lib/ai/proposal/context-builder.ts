/**
 * Phase AI-5C.1: Canonical AI Proposal Context Builder
 * 
 * Assembles safe, minimized, tenant-isolated context for AI proposal tasks.
 * 
 * Invariants:
 * - Server-Authoritative: Identity, tenant, role, and permissions are derived strictly server-side.
 * - Tenant Isolation: Inquiry, traveler, versions, and knowledge are verified against ctx.tenantId.
 * - Context Minimization: Non-admin/manager roles NEVER receive supplier costs or margin data in prompt context.
 * - Anti-Prompt-Injection: Untrusted customer and retrieved text is wrapped in data delimiters.
 */

import { can } from '@/lib/permissions';
import { getAuthenticatedStaffContext, withPgClient } from '@/app/actions/inquiry-lifecycle';
import { shapeQuoteVersionDTO } from '@/lib/quotes-itineraries/service';
import type { ItineraryVersionEntity } from '@/lib/quotes-itineraries/types';

export interface ProposalContextParams {
  inquiryId: string;
  itineraryVersionId?: string | null;
  quoteVersionId?: string | null;
  staffInstruction?: string | null;
  includeKnowledge?: boolean;
}

export interface InquiryFactsContext {
  id: string;
  travelerName: string;
  travelerEmail?: string;
  destination: string | null;
  stage: string | null;
  passengerCount: number | null;
  departureDate: string | null;
  returnDate: string | null;
  budget: string | null;
  currency: string;
  tripType: string | null;
  specialRequests: string | null;
  notes: string | null;
}

export interface ConversationMessageContext {
  id: string;
  senderType: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface KnowledgeItemContext {
  id: string;
  title: string;
  content: string;
  sourceType: string;
}

export interface AI5CProposalContext {
  tenantId: string;
  actorUserId: string;
  actorRole: string;
  hasInternalPricingAccess: boolean;
  inquiry: InquiryFactsContext;
  conversationMessages: ConversationMessageContext[];
  baseItineraryVersion: ItineraryVersionEntity | null;
  baseQuoteVersion: Record<string, unknown> | null;
  knowledgeItems: KnowledgeItemContext[];
  staffInstruction: string | null;
  formattedSystemPromptContext: string;
}

/**
 * Builds the canonical proposal context for an inquiry.
 */
export async function buildProposalContext(
  params: ProposalContextParams,
  overrideCtx?: { tenantId: string; userId: string; role: string }
): Promise<AI5CProposalContext> {
  const ctx = overrideCtx || (await getAuthenticatedStaffContext());
  const hasInternalPricing = can(ctx.role, 'quotes:internal_pricing:read');

  return withPgClient(async (client) => {
    // 1. Fetch and verify Inquiry & Traveler Profile
    const inqRes = await client.query(
      `SELECT 
        i.id,
        i.tenant_id,
        i.traveler_id,
        i.destination,
        i.stage,
        i.travelers_count,
        i.departure_date,
        i.return_date,
        i.estimated_budget,
        i.currency,
        i.trip_type,
        i.requirements,
        i.notes,
        tp.first_name,
        tp.last_name,
        tp.email
      FROM public.inquiries i
      LEFT JOIN public.traveler_profiles tp 
        ON tp.id = i.traveler_id AND tp.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2`,
      [params.inquiryId, ctx.tenantId]
    );

    if (inqRes.rows.length === 0) {
      throw new Error(`NOT_FOUND: Inquiry ${params.inquiryId} not found in tenant ${ctx.tenantId}`);
    }

    const inq = inqRes.rows[0];
    const travelerName = [inq.first_name, inq.last_name].filter(Boolean).join(' ') || 'Valued Traveler';

    const inquiryFacts: InquiryFactsContext = {
      id: String(inq.id),
      travelerName,
      travelerEmail: ctx.role === 'viewer' ? undefined : (inq.email ? String(inq.email) : undefined),
      destination: inq.destination ? String(inq.destination) : null,
      stage: inq.stage ? String(inq.stage) : null,
      passengerCount: inq.travelers_count != null ? Number(inq.travelers_count) : null,
      departureDate: inq.departure_date ? String(inq.departure_date) : null,
      returnDate: inq.return_date ? String(inq.return_date) : null,
      budget: inq.estimated_budget != null ? String(inq.estimated_budget) : null,
      currency: inq.currency ? String(inq.currency) : 'USD',
      tripType: inq.trip_type ? String(inq.trip_type) : null,
      specialRequests: inq.requirements ? String(inq.requirements) : null,
      notes: hasInternalPricing ? (inq.notes ? String(inq.notes) : null) : null,
    };

    // 2. Fetch Conversation Messages
    const convRes = await client.query(
      `SELECT m.id, m.sender_type, m.sender_name, m.content, m.created_at
       FROM public.messages m
       JOIN public.conversations c ON c.id = m.conversation_id
       WHERE c.lead_id = $1 AND c.tenant_id = $2
       ORDER BY m.created_at ASC
       LIMIT 20`,
      [params.inquiryId, ctx.tenantId]
    );

    const conversationMessages: ConversationMessageContext[] = convRes.rows.map((r) => ({
      id: String(r.id),
      senderType: String(r.sender_type),
      senderName: String(r.sender_name || r.sender_type),
      content: String(r.content),
      createdAt: String(r.created_at),
    }));

    // 3. Fetch Base Itinerary Version if requested
    let baseItineraryVersion: ItineraryVersionEntity | null = null;
    if (params.itineraryVersionId) {
      const ivRes = await client.query(
        `SELECT iv.*, i.title as family_title
         FROM public.itinerary_versions iv
         JOIN public.itineraries i ON i.id = iv.itinerary_id
         WHERE iv.id = $1 AND iv.tenant_id = $2`,
        [params.itineraryVersionId, ctx.tenantId]
      );
      if (ivRes.rows.length === 0) {
        throw new Error(`NOT_FOUND: Base itinerary version ${params.itineraryVersionId} not found in tenant ${ctx.tenantId}`);
      }
      const iv = ivRes.rows[0];
      baseItineraryVersion = {
        id: String(iv.id),
        tenantId: String(iv.tenant_id),
        itineraryId: String(iv.itinerary_id),
        versionNumber: Number(iv.version_number),
        lockVersion: Number(iv.lock_version || 0),
        status: iv.status,
        title: String(iv.title || iv.family_title || 'Untitled Itinerary'),
        destinationSummary: iv.destination_summary ? String(iv.destination_summary) : null,
        startDate: iv.start_date ? String(iv.start_date) : null,
        endDate: iv.end_date ? String(iv.end_date) : null,
        durationDays: iv.duration_days != null ? Number(iv.duration_days) : null,
        passengerCount: iv.passenger_count != null ? Number(iv.passenger_count) : null,
        days: Array.isArray(iv.days) ? iv.days : [],
        inclusions: Array.isArray(iv.inclusions) ? iv.inclusions : [],
        exclusions: Array.isArray(iv.exclusions) ? iv.exclusions : [],
        itinerarySchemaVersion: Number(iv.itinerary_schema_version || 1),
        createdAt: String(iv.created_at),
        updatedAt: String(iv.updated_at),
      };
    }

    // 4. Fetch Base Quote Version if requested
    let baseQuoteVersion: Record<string, unknown> | null = null;
    if (params.quoteVersionId) {
      const qvRes = await client.query(
        `SELECT qv.*, q.quote_number
         FROM public.quote_versions qv
         JOIN public.quotes q ON q.id = qv.quote_id
         WHERE qv.id = $1 AND qv.tenant_id = $2`,
        [params.quoteVersionId, ctx.tenantId]
      );
      if (qvRes.rows.length === 0) {
        throw new Error(`NOT_FOUND: Base quote version ${params.quoteVersionId} not found in tenant ${ctx.tenantId}`);
      }
      const shaped = shapeQuoteVersionDTO(
        qvRes.rows[0] as unknown as Parameters<typeof shapeQuoteVersionDTO>[0],
        ctx.role
      );
      baseQuoteVersion = shaped as unknown as Record<string, unknown>;
    }

    // 5. Fetch Relevant Knowledge / Packages
    const knowledgeItems: KnowledgeItemContext[] = [];
    if (params.includeKnowledge !== false) {
      const destKeyword = inquiryFacts.destination ? `%${inquiryFacts.destination.toLowerCase()}%` : '%';
      const kRes = await client.query(
        `SELECT id, title, content, source_type
         FROM public.knowledge_documents
         WHERE tenant_id = $1 
           AND (LOWER(title) LIKE $2 OR LOWER(content) LIKE $2 OR source_type = 'package')
         LIMIT 5`,
        [ctx.tenantId, destKeyword]
      );
      for (const r of kRes.rows) {
        knowledgeItems.push({
          id: String(r.id),
          title: String(r.title),
          content: String(r.content),
          sourceType: String(r.source_type),
        });
      }

      // Also grab relevant FAQs
      const faqRes = await client.query(
        `SELECT id, question, answer, category
         FROM public.faq_entries
         WHERE tenant_id = $1 AND enabled = true
         LIMIT 5`,
        [ctx.tenantId]
      );
      for (const r of faqRes.rows) {
        knowledgeItems.push({
          id: String(r.id),
          title: `FAQ: ${r.question}`,
          content: String(r.answer),
          sourceType: 'faq',
        });
      }
    }

    // 6. Format Delimited System Context with Strict Anti-Injection Boundaries
    const formattedSystemPromptContext = formatPromptContext({
      inquiry: inquiryFacts,
      conversationMessages,
      baseItineraryVersion,
      baseQuoteVersion,
      knowledgeItems,
      staffInstruction: params.staffInstruction || null,
      hasInternalPricing,
    });

    return {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      hasInternalPricingAccess: hasInternalPricing,
      inquiry: inquiryFacts,
      conversationMessages,
      baseItineraryVersion,
      baseQuoteVersion,
      knowledgeItems,
      staffInstruction: params.staffInstruction || null,
      formattedSystemPromptContext,
    };
  });
}

/**
 * Helper to construct anti-injection delimited prompt context.
 */
export function formatPromptContext(data: {
  inquiry: InquiryFactsContext;
  conversationMessages: ConversationMessageContext[];
  baseItineraryVersion: ItineraryVersionEntity | null;
  baseQuoteVersion: Record<string, unknown> | null;
  knowledgeItems: KnowledgeItemContext[];
  staffInstruction: string | null;
  hasInternalPricing: boolean;
}): string {
  const sections: string[] = [];

  // 1. Inquiry Facts
  sections.push(`
<untrusted_inquiry_facts>
Destination: ${data.inquiry.destination || 'Unspecified'}
Passenger Count: ${data.inquiry.passengerCount ?? 'Unspecified'}
Travel Dates: ${data.inquiry.departureDate || 'TBD'} to ${data.inquiry.returnDate || 'TBD'}
Budget: ${data.inquiry.budget ? `${data.inquiry.currency} ${data.inquiry.budget}` : 'Unspecified'}
Trip Type: ${data.inquiry.tripType || 'Standard'}
Special Requests: ${data.inquiry.specialRequests || 'None'}
Internal Notes: ${data.inquiry.notes || 'None'}
</untrusted_inquiry_facts>`);

  // 2. Conversation Messages
  if (data.conversationMessages.length > 0) {
    const msgs = data.conversationMessages
      .map((m) => `[${m.senderName}]: ${m.content}`)
      .join('\n');
    sections.push(`
<untrusted_customer_conversation>
${msgs}
</untrusted_customer_conversation>`);
  }

  // 3. Base Itinerary
  if (data.baseItineraryVersion) {
    const daysJson = JSON.stringify(data.baseItineraryVersion.days, null, 2);
    sections.push(`
<untrusted_base_itinerary>
Title: ${data.baseItineraryVersion.title}
Duration Days: ${data.baseItineraryVersion.durationDays ?? 'N/A'}
Days Structure:
${daysJson}
Inclusions: ${data.baseItineraryVersion.inclusions?.join(', ') || 'None'}
Exclusions: ${data.baseItineraryVersion.exclusions?.join(', ') || 'None'}
</untrusted_base_itinerary>`);
  }

  // 4. Base Quote
  if (data.baseQuoteVersion) {
    const safeQuoteJson = JSON.stringify(data.baseQuoteVersion, null, 2);
    sections.push(`
<untrusted_base_quote>
${safeQuoteJson}
</untrusted_base_quote>`);
  }

  // 5. Retrieved Knowledge
  if (data.knowledgeItems.length > 0) {
    const kDocs = data.knowledgeItems
      .map((k) => `[Document ${k.id} - ${k.title} (${k.sourceType})]\n${k.content}`)
      .join('\n\n');
    sections.push(`
<untrusted_retrieved_knowledge>
${kDocs}
</untrusted_retrieved_knowledge>`);
  }

  // 6. Staff Instruction
  if (data.staffInstruction) {
    sections.push(`
<staff_instruction>
${data.staffInstruction}
</staff_instruction>`);
  }

  return sections.join('\n\n');
}
