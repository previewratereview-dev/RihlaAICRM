/**
 * StateAI AI Operating System (AIOS) — Tool Permission Guard
 * 
 * Verifies tool permission requirements against AIExecutionContext permissions
 * and delegates risk-level and action governance to the authoritative PolicyEngine.
 */

import type { AIOSTool } from './types';
import type { AIExecutionContext } from '../types';
import { defaultPolicyEngine, type PolicyEngine, type PolicyAction } from '../policies';

export interface ToolPermissionDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiresHITL?: boolean;
}

export class ToolPermissionGuard {
  private policyEngine: PolicyEngine;

  constructor(policyEngine: PolicyEngine = defaultPolicyEngine) {
    this.policyEngine = policyEngine;
  }

  async checkPermissions(tool: AIOSTool, context: AIExecutionContext): Promise<ToolPermissionDecision> {
    // Step 1: Check Required Permissions against AIExecutionContext
    if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
      const userPerms = context.permissions || [];
      const hasWildcard = userPerms.includes('*') || userPerms.includes('admin');
      
      if (!hasWildcard) {
        const missingPerms = tool.requiredPermissions.filter(p => !userPerms.includes(p));
        if (missingPerms.length > 0) {
          return {
            allowed: false,
            reason: `Permission Guard: Missing required permissions [${missingPerms.join(', ')}] for tool '${tool.id}'`,
          };
        }
      }
    }

    // Step 2: Risk-Level Governance
    if (tool.riskLevel === 'critical') {
      return {
        allowed: true,
        requiresHITL: true,
        reason: `Risk Governance: Tool '${tool.id}' is classified as critical risk and requires human review`,
      };
    }

    // Step 3: Map tool categories or actions to PolicyEngine rules
    if (tool.category === 'crm' && (tool.id.includes('delete') || tool.id.includes('remove'))) {
      const decision = await this.policyEngine.evaluate(context, 'delete_record' as PolicyAction);
      if (!decision.allowed || decision.requiresHITL) {
        return {
          allowed: decision.allowed,
          requiresHITL: decision.requiresHITL,
          reason: decision.reason || `Policy Engine restricted destructive tool '${tool.id}'`,
        };
      }
    }

    if (tool.id.includes('email') || tool.id.includes('mail')) {
      const decision = await this.policyEngine.evaluate(context, 'send_email' as PolicyAction);
      if (!decision.allowed || decision.requiresHITL) {
        return {
          allowed: decision.allowed,
          requiresHITL: decision.requiresHITL,
          reason: decision.reason || `Policy Engine restricted messaging tool '${tool.id}'`,
        };
      }
    }

    return { allowed: true };
  }
}

export const defaultToolPermissionGuard = new ToolPermissionGuard();
