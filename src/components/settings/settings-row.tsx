import React from 'react';
import { cn } from '@/lib/utils';

interface SettingsRowProps {
  label: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SettingsRow({ label, description, children, action, className }: SettingsRowProps) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-[45%_35%_20%] gap-4 p-5 hover:bg-muted/10 transition-colors items-start md:items-center", className)}>
      <div className="pr-4">
        <label className="text-sm font-medium text-foreground block mb-1">{label}</label>
        {description && <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>}
      </div>
      <div className="flex-1 w-full flex items-center">
        {children}
      </div>
      <div className="flex items-center justify-start md:justify-end w-full md:pl-4">
        {action}
      </div>
    </div>
  );
}
