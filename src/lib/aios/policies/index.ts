/**
 * StateAI AI Operating System (AIOS) — Policy Engine
 * 
 * NOT RBAC. This is authoritative operational policy governance for the AI Agent.
 * Determines what actions an AI instance is permitted to take regardless of user role.
 * 
 * Evaluates rules sequentially across four strict categories:
 * 1. Security Policy -> 2. Compliance Policy -> 3. Operational Policy -> 4. Business Policy
 */

import type { AIExecutionContext } from '../types';

export interface PolicyVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
}

export type PolicyCategory = 'security' | 'compliance' | 'operational' | 'business';

export type PolicyAction =
  | 'delete_record'
  | 'send_email'
  | 'send_whatsapp'
  | 'spend_money'
  | 'update_booking'
  | 'create_invoice'
  | 'run_autonomously'
  | 'export_gdpr_data'
  | 'merge_records';

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresHITL?: boolean;
  readonly evaluatedCategory?: PolicyCategory;
}

export interface PolicyRule {
  readonly id: string;
  readonly category: PolicyCategory;
  readonly version: PolicyVersion;
  readonly action: PolicyAction | '*';
  readonly evaluate: (context: AIExecutionContext, resource?: Record<string, unknown>) => PolicyDecision | Promise<PolicyDecision>;
}

export interface PolicyEngine {
  evaluate(context: AIExecutionContext, action: PolicyAction, resource?: Record<string, unknown>): Promise<PolicyDecision>;
  registerRule(rule: PolicyRule): void;
  removeRule(ruleId: string): boolean;
  listRules(category?: PolicyCategory): PolicyRule[];
}

export class DefaultPolicyEngine implements PolicyEngine {
  private rules: Map<string, PolicyRule> = new Map();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaultRules();
    }
  }

  registerRule(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  listRules(category?: PolicyCategory): PolicyRule[] {
    const all = Array.from(this.rules.values());
    if (!category) return all;
    return all.filter(r => r.category === category);
  }

  async evaluate(context: AIExecutionContext, action: PolicyAction, resource?: Record<string, unknown>): Promise<PolicyDecision> {
    // Strict evaluation sequence: security -> compliance -> operational -> business
    const evaluationOrder: PolicyCategory[] = ['security', 'compliance', 'operational', 'business'];

    for (const category of evaluationOrder) {
      const categoryRules = this.listRules(category);
      for (const rule of categoryRules) {
        if (rule.action === action || rule.action === '*') {
          const decision = await rule.evaluate(context, resource);
          // If any rule explicitly denies or requires HITL, enforce immediately
          if (!decision.allowed || decision.requiresHITL) {
            return {
              ...decision,
              evaluatedCategory: category,
            };
          }
        }
      }
    }

    // Default allow if no policy rule forbids it
    return { allowed: true };
  }

  private registerDefaultRules(): void {
    const defaultVer: PolicyVersion = { major: 1, minor: 0, patch: 0 };

    // Security Policy: Deleting records is denied for viewers/members
    this.registerRule({
      id: 'policy.security.delete_record',
      category: 'security',
      version: defaultVer,
      action: 'delete_record',
      evaluate: (ctx) => {
        if (ctx.metadata?.userRole === 'viewer' || ctx.metadata?.userRole === 'member') {
          return { allowed: false, reason: 'Security Policy: User role lacks sufficient privilege for record deletion' };
        }
        return { allowed: true };
      },
    });

    // Compliance Policy: GDPR data export requires HITL audit logging
    this.registerRule({
      id: 'policy.compliance.gdpr_export',
      category: 'compliance',
      version: defaultVer,
      action: 'export_gdpr_data',
      evaluate: () => ({ allowed: true, requiresHITL: true, reason: 'Compliance Policy: GDPR data export requires human compliance review' }),
    });

    // Operational Policy: Deleting records by admins requires HITL confirmation
    this.registerRule({
      id: 'policy.operational.delete_record_hitl',
      category: 'operational',
      version: defaultVer,
      action: 'delete_record',
      evaluate: () => ({ allowed: true, requiresHITL: true, reason: 'Operational Policy: Record deletion is a destructive action requiring human confirmation' }),
    });

    // Operational Policy: Outbound messaging requires HITL unless autonomous mode is approved
    this.registerRule({
      id: 'policy.operational.outbound_email',
      category: 'operational',
      version: defaultVer,
      action: 'send_email',
      evaluate: (ctx) => {
        if (ctx.metadata?.autonomousApproved === true) return { allowed: true };
        return { allowed: true, requiresHITL: true, reason: 'Operational Policy: Outbound email sending requires human review' };
      },
    });

    this.registerRule({
      id: 'policy.operational.send_whatsapp',
      category: 'operational',
      version: defaultVer,
      action: 'send_whatsapp',
      evaluate: (ctx) => {
        if (ctx.metadata?.autonomousApproved === true) return { allowed: true };
        return { allowed: true, requiresHITL: true, reason: 'Operational Policy: Outbound WhatsApp sending requires human review' };
      },
    });

    // Business Policy: Spending money > $500 requires HITL
    this.registerRule({
      id: 'policy.business.spend_money',
      category: 'business',
      version: defaultVer,
      action: 'spend_money',
      evaluate: (ctx, resource) => {
        const amount = Number(resource?.amount || 0);
        if (amount > 500) {
          return { allowed: true, requiresHITL: true, reason: `Business Policy: Financial expenditure of $${amount} exceeds autonomous threshold ($500)` };
        }
        return { allowed: true };
      },
    });
  }
}

export const defaultPolicyEngine = new DefaultPolicyEngine();
