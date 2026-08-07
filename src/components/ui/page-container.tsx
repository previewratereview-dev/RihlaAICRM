import React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const pageContainerVariants = cva(
  'mx-auto w-full transition-all',
  {
    variants: {
      variant: {
        form: 'max-w-[900px] px-[var(--page-padding-x)]',
        data: 'px-[var(--page-padding-x)]',
        board: 'px-[max(12px,calc(var(--page-padding-x)/2))] overflow-x-hidden',
        split: '',
      },
    },
    defaultVariants: {
      variant: 'data',
    },
  }
);

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof pageContainerVariants> {}

export function PageContainer({ className, variant, ...props }: PageContainerProps) {
  return (
    <div
      className={cn(pageContainerVariants({ variant }), className)}
      {...props}
    />
  );
}
