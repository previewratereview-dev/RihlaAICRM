/**
 * StateAI AI Operating System (AIOS) — Retrieval Policy Engine
 * 
 * Dynamically evaluates queries and intent tags to select the optimal
 * retrieval strategy and target domains instead of hardcoding retrieval logic.
 * 
 * Target domains:
 * - 'crm' (Active CRM lead, booking, customer records)
 * - 'memory' (Conversation history, episodic & working memory)
 * - 'internal_knowledge' (SOPs, company policies, internal documents)
 * - 'external_knowledge' (Web, live APIs, weather, flight prices, exchange rates, visa rules)
 */

export type RetrievalTargetDomain =
  | 'crm'
  | 'memory'
  | 'internal_knowledge'
  | 'external_knowledge';

export interface RetrievalPolicyDecision {
  readonly targetDomains: RetrievalTargetDomain[];
  readonly strategy: string;
  readonly reason: string;
  readonly requireVerifiedOnly?: boolean;
  readonly minTrustScore?: number;
}

export interface RetrievalPolicyRule {
  readonly name: string;
  readonly description: string;
  readonly pattern: RegExp;
  readonly domains: RetrievalTargetDomain[];
  readonly strategy: string;
  readonly minTrustScore?: number;
}

export class RetrievalPolicyEngine {
  private rules: RetrievalPolicyRule[] = [
    {
      name: 'live_crm_query',
      description: 'Queries regarding current bookings, active leads, or invoices',
      pattern: /\b(?:today|booking|lead|invoice|customer record|active|status of|payment)\b/i,
      domains: ['crm'],
      strategy: 'deterministic_crm_lookup',
      minTrustScore: 0.8,
    },
    {
      name: 'external_live_data',
      description: 'Queries requiring external web, API, weather, flight price, or government visa data',
      pattern: /\b(?:visa|weather|exchange rate|flight price|external|government|map|traffic|live price)\b/i,
      domains: ['external_knowledge'],
      strategy: 'live_api_and_web_search',
      minTrustScore: 0.7,
    },
    {
      name: 'conversation_history',
      description: 'Queries recalling previous customer chats or preferences from memory',
      pattern: /\b(?:yesterday|last time|previously|asked before|remember|history|conversation|chat)\b/i,
      domains: ['memory'],
      strategy: 'episodic_and_semantic_memory_recall',
    },
    {
      name: 'customer_360_summary',
      description: 'Holistic summaries of a customer, company, or account',
      pattern: /\b(?:summarize|summary|overview|profile|tell me about customer|360|background)\b/i,
      domains: ['crm', 'memory', 'internal_knowledge'],
      strategy: 'multi_domain_360_fusion',
      minTrustScore: 0.75,
    },
    {
      name: 'internal_sop_policy',
      description: 'Queries regarding standard operating procedures, cancellation rules, or company guidelines',
      pattern: /\b(?:policy|sop|procedure|rule|guideline|refund|cancellation|allowance|terms)\b/i,
      domains: ['internal_knowledge'],
      strategy: 'hybrid_rag_sop_search',
      minTrustScore: 0.85,
    },
  ];

  /**
   * Register a custom retrieval policy rule.
   */
  registerRule(rule: RetrievalPolicyRule): void {
    this.rules.unshift(rule); // Higher priority for custom rules
  }

  /**
   * Evaluate a natural language query and return the optimal retrieval decision.
   */
  evaluate(query: string, explicitDomains?: RetrievalTargetDomain[]): RetrievalPolicyDecision {
    if (explicitDomains && explicitDomains.length > 0) {
      return {
        targetDomains: explicitDomains,
        strategy: 'explicit_override',
        reason: 'Caller explicitly specified target retrieval domains',
      };
    }

    const matchedDomains = new Set<RetrievalTargetDomain>();
    const matchedStrategies: string[] = [];
    const reasons: string[] = [];
    let minTrust = 0.6;

    for (const rule of this.rules) {
      if (rule.pattern.test(query)) {
        for (const d of rule.domains) matchedDomains.add(d);
        matchedStrategies.push(rule.strategy);
        reasons.push(rule.description);
        if (rule.minTrustScore && rule.minTrustScore > minTrust) {
          minTrust = rule.minTrustScore;
        }
      }
    }

    if (matchedDomains.size === 0) {
      // Default fallback: search internal knowledge and CRM
      return {
        targetDomains: ['internal_knowledge', 'crm'],
        strategy: 'default_hybrid_search',
        reason: 'No specific policy pattern matched; defaulting to internal knowledge and CRM',
        minTrustScore: 0.7,
      };
    }

    return {
      targetDomains: Array.from(matchedDomains),
      strategy: matchedStrategies.join(' + '),
      reason: `Matched policies: ${reasons.join('; ')}`,
      minTrustScore: minTrust,
    };
  }
}

export const defaultRetrievalPolicyEngine = new RetrievalPolicyEngine();
