'use client';

import React, { useState } from 'react';
import { DEFAULT_WORKFLOW_RULES, type WorkflowRule } from '@/lib/automation/triggers';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';

export function WorkflowRulesPanel() {
  const [rules, setRules] = useState<WorkflowRule[]>(DEFAULT_WORKFLOW_RULES);

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const saveRules = async () => {
    await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Workflow Automation Rules</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Rule-based triggers: when conditions match, actions run automatically on lead events.
      </p>
      <div className="space-y-2">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-xl border border-border/60 p-3 bg-card/50"
          >
            <div>
              <p className="text-sm font-medium">{rule.name}</p>
              <p className="text-[10px] text-muted-foreground font-mono">
                {rule.triggerType} · {rule.conditions.length} condition(s) · {rule.actions.length} action(s)
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleRule(rule.id)}
              className={`text-xs px-3 py-1 rounded-full font-semibold ${
                rule.enabled ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {rule.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={saveRules}>Save Workflow Rules</Button>
    </div>
  );
}
