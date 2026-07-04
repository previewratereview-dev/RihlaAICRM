/**
 * StateAI AI Operating System (AIOS) — Learning & Behavior Adaptation Engine
 * 
 * Authoritative learning subsystem converting conversation history and user feedback
 * into continuous behavior adaptations and prompt preferences:
 * - Conversation -> Memory -> Learning -> Behavior Adaptation
 * - Captures user rejections (e.g., rejected itinerary formats)
 * - Learns communication preferences (e.g., concise emails, currency defaults)
 * - Automatically adapts future system prompts and planner strategies
 */

import type { AIExecutionContext } from '../types';
import { generateCitationId } from '../knowledge/types';

export type LearnedPreferenceCategory =
  | 'communication_style'
  | 'output_format'
  | 'tool_preference'
  | 'workflow_adaptation'
  | 'domain_rule';

export interface LearnedPreference {
  readonly id: string;
  readonly citationId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly category: LearnedPreferenceCategory;
  readonly preference: string;
  readonly confidence: number;
  readonly sourceEvent: string;
  readonly timestamp: Date;
  readonly active: boolean;
}

export interface BehaviorAdaptation {
  readonly id: string;
  readonly triggerCondition: string;
  readonly adaptedAction: string;
  readonly appliedCount: number;
  readonly lastApplied: Date;
}

export class LearningEngine {
  private preferences: Map<string, LearnedPreference[]> = new Map();

  /**
   * Record and learn from explicit user feedback or corrections.
   */
  async learnFromFeedback(
    userId: string,
    tenantId: string,
    feedback: string,
    category: LearnedPreferenceCategory = 'communication_style',
    context?: AIExecutionContext
  ): Promise<LearnedPreference> {
    const id = `pref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const pref: LearnedPreference = {
      id,
      citationId: generateCitationId('POL', id),
      userId,
      tenantId,
      category,
      preference: feedback,
      confidence: 0.95,
      sourceEvent: 'explicit_user_feedback',
      timestamp: new Date(),
      active: true,
    };

    const key = `${tenantId}:${userId}`;
    const list = this.preferences.get(key) || [];
    list.push(pref);
    this.preferences.set(key, list);

    return pref;
  }

  /**
   * Learn from a rejected action or output (e.g., user rejects AI-generated itinerary twice).
   */
  async learnFromRejection(
    userId: string,
    tenantId: string,
    rejectedAction: string,
    reason: string,
    context?: AIExecutionContext
  ): Promise<LearnedPreference> {
    const id = `rejection_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const pref: LearnedPreference = {
      id,
      citationId: generateCitationId('POL', id),
      userId,
      tenantId,
      category: 'output_format',
      preference: `Avoid format/action '${rejectedAction}': User prefers ${reason}`,
      confidence: 0.90,
      sourceEvent: 'user_action_rejection',
      timestamp: new Date(),
      active: true,
    };

    const key = `${tenantId}:${userId}`;
    const list = this.preferences.get(key) || [];
    list.push(pref);
    this.preferences.set(key, list);

    return pref;
  }

  /**
   * Get all active learned preferences and adaptations for a user/tenant.
   */
  async getAdaptations(userId: string, tenantId: string): Promise<LearnedPreference[]> {
    const key = `${tenantId}:${userId}`;
    return (this.preferences.get(key) || []).filter(p => p.active);
  }

  /**
   * Apply learned behavior adaptations automatically to a system prompt or instruction.
   */
  async applyAdaptationsToPrompt(prompt: string, userId: string, tenantId: string): Promise<string> {
    const adaptations = await this.getAdaptations(userId, tenantId);
    if (adaptations.length === 0) return prompt;

    const rules = adaptations
      .map(a => `• [${a.citationId}] (${a.category}): ${a.preference}`)
      .join('\n');

    return `${prompt}\n\n### Learned User Preferences & Behavior Adaptations:\n${rules}`;
  }
}

export const defaultLearningEngine = new LearningEngine();
