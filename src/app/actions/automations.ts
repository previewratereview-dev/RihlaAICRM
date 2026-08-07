'use server';

import type { Lead } from '@/types';
import { runLeadCreatedAutomations as _runLeadCreated, runLeadStatusAutomations as _runLeadStatus, AutomationSettings } from '@/lib/automation/triggers';

export async function runLeadCreatedAutomationsAction(lead: Lead, settings: AutomationSettings) {
  try {
    await _runLeadCreated(lead, settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to run lead created automations:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function runLeadStatusAutomationsAction(lead: Lead, previousStatus: string, settings: AutomationSettings) {
  try {
    await _runLeadStatus(lead, previousStatus, settings);
    return { success: true };
  } catch (error) {
    console.error('Failed to run lead status automations:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
