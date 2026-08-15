/**
 * CRM Copilot Knowledge Retrieval Tool (Phase AI-2)
 * 
 * Bounded, tenant-scoped knowledge search across agency documents and FAQs.
 * Returns structured source citations [S1], [S2] with inspectable metadata.
 * Strictly treats knowledge content as UNTRUSTED DATA (prompt injection boundary).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type TrustedExecutionContext,
  type ToolResult,
  type ToolDefinition,
  type KnowledgeSearchResult,
  type KnowledgeSource,
  SearchAgencyKnowledgeSchema,
} from './types';
import { embedText, cosineSimilarity } from '@/lib/ai/rag';

export const searchAgencyKnowledgeTool: ToolDefinition<typeof SearchAgencyKnowledgeSchema, KnowledgeSearchResult> = {
  name: 'searchAgencyKnowledge',
  description: 'Search the agency knowledge base for official policies (cancellation, refunds, baggage, visas), destination guides, supplier contacts, and FAQs. Returns structured source citations.',
  parameters: SearchAgencyKnowledgeSchema,
  execute: async (
    context: TrustedExecutionContext,
    params,
    supabase: SupabaseClient
  ): Promise<ToolResult<KnowledgeSearchResult>> => {
    try {
      const query = params.query.trim();
      const limit = Math.min(params.limit || 4, 5);

      // 1. Embed query
      const queryEmbedding = await embedText(query);

      // 2. Fetch tenant documents (max 30)
      const { data: docs, error: docErr } = await supabase
        .from('knowledge_documents')
        .select('id, title, content, source_type, embedding')
        .eq('tenant_id', context.tenantId)
        .limit(30);

      if (docErr) {
        console.error('[Copilot Tool Error] searchAgencyKnowledge docs query failed:', docErr.message);
      }

      // 3. Fetch tenant FAQs (max 30)
      const { data: faqs, error: faqErr } = await supabase
        .from('faq_entries')
        .select('id, question, answer, category')
        .eq('tenant_id', context.tenantId)
        .limit(30);

      if (faqErr) {
        console.error('[Copilot Tool Error] searchAgencyKnowledge faqs query failed:', faqErr.message);
      }

      const allCandidates: Array<{
        id: string;
        title: string;
        content: string;
        sourceType: string;
        embedding: number[] | null;
      }> = [];

      for (const d of docs || []) {
        allCandidates.push({
          id: String(d.id),
          title: d.title || 'Agency Document',
          content: d.content || '',
          sourceType: d.source_type || 'document',
          embedding: Array.isArray(d.embedding) ? d.embedding : null,
        });
      }

      for (const f of faqs || []) {
        allCandidates.push({
          id: String(f.id),
          title: f.question || 'FAQ',
          content: f.answer || '',
          sourceType: 'faq',
          embedding: null, // will compute on the fly if needed
        });
      }

      // If any items lack embeddings, compute them
      for (const item of allCandidates) {
        if (!item.embedding) {
          item.embedding = await embedText(`${item.title}\n${item.content}`);
        }
      }

      // 4. Rank by cosine similarity
      const ranked = allCandidates
        .map((item) => ({
          ...item,
          score: item.embedding ? cosineSimilarity(queryEmbedding, item.embedding) : 0,
        }))
        // Relevance threshold: 0.10 to filter out unrelated noise
        .filter((item) => item.score >= 0.10)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (ranked.length === 0) {
        return {
          success: true,
          data: {
            answerContext: 'No relevant agency knowledge documents or FAQs found for this query in the workspace.',
            sources: [],
          },
        };
      }

      // 5. Build structured sources and citation handles [S1], [S2]...
      const sources: KnowledgeSource[] = ranked.map((item) => {
        const rawContent = item.content;
        const excerpt = rawContent.length > 250 ? `${rawContent.slice(0, 247)}...` : rawContent;

        return {
          sourceId: item.id,
          title: item.title,
          sourceType: item.sourceType,
          excerpt,
          score: Math.round(item.score * 100) / 100,
        };
      });

      const contextLines = ranked.map((item, index) => {
        const handle = `[S${index + 1}]`;
        // Delimit document content clearly as UNTRUSTED DATA
        return `${handle} Title: "${item.title}" (Type: ${item.sourceType}):\n--- BEGIN SOURCE CONTENT ---\n${item.content}\n--- END SOURCE CONTENT ---`;
      });

      const answerContext = `AGENCY KNOWLEDGE SOURCES FOUND (${ranked.length}):\n\n${contextLines.join('\n\n')}`;

      return {
        success: true,
        data: {
          answerContext,
          sources,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Copilot Tool Exception] searchAgencyKnowledge:', msg);
      return { success: false, error: 'Error searching agency knowledge base' };
    }
  },
};
