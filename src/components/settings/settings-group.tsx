import React from 'react';

export function SettingsGroup({ title, description, children }: { title: string, description?: React.ReactNode, children: React.ReactNode }) {
  return (
    <div className="mb-10 last:mb-0">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      <div className="flex flex-col rounded-2xl overflow-hidden border border-border/50 bg-card/20 divide-y divide-border/40 shadow-sm">
        {children}
      </div>
    </div>
  );
}
