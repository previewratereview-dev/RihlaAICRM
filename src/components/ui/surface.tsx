import React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const surfaceVariants = cva(
  'rounded-[var(--radius-surface)] bg-card border border-border/60 shadow-sm transition-all text-card-foreground',
  {
    variants: {
      density: {
        default: 'p-[var(--surface-padding)]',
        compact: 'p-[var(--surface-padding-compact)]',
        none: '',
      },
    },
    defaultVariants: {
      density: 'default',
    },
  }
);

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

export function Surface({ className, density, ...props }: SurfaceProps) {
  return (
    <div
      className={cn(surfaceVariants({ density }), className)}
      {...props}
    />
  );
}
