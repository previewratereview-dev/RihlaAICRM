import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Update to support custom SVG components as well as Lucide icons
interface SettingItemProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  value?: React.ReactNode;
  buttonText?: string;
  danger?: boolean;
  onClick?: () => void;
  className?: string;
}

export function SettingItem({
  title,
  description,
  icon: Icon,
  value,
  buttonText = 'Update',
  danger = false,
  onClick,
  className
}: SettingItemProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 transition-colors gap-4", className)}>
      <div className="flex gap-4 items-start sm:items-center">
        <div className="p-2.5 rounded-lg bg-muted/50 text-muted-foreground shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          {value && (
            <div className="mt-2 text-sm font-mono bg-muted/50 px-2 py-1 rounded-md inline-block text-muted-foreground">
              {value}
            </div>
          )}
        </div>
      </div>
      {onClick && (
        <Button 
          variant={danger ? "destructive" : "secondary"} 
          size="sm" 
          onClick={onClick}
          className="shrink-0 sm:self-center self-start"
        >
          {buttonText}
        </Button>
      )}
    </div>
  );
}
