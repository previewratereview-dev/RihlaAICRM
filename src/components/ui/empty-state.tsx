import React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Search, FolderOpen, Inbox } from 'lucide-react';

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-center',
  {
    variants: {
      variant: {
        module: 'min-h-[140px] max-h-[220px] p-[var(--page-padding-y)]',
        result: 'min-h-[120px] p-6',
        'table-row': 'h-[var(--table-row-height)] p-4',
      },
    },
    defaultVariants: {
      variant: 'module',
    },
  }
);

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  title?: string;
  description: string;
  icon?: 'inbox' | 'search' | 'folder' | React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ 
  className, 
  variant, 
  title, 
  description, 
  icon = 'inbox',
  action,
  ...props 
}: EmptyStateProps) {
  
  const renderIcon = () => {
    if (React.isValidElement(icon)) return icon;
    
    const iconClass = "h-8 w-8 text-muted-foreground/60 mb-3";
    switch (icon) {
      case 'search': return <Search className={iconClass} />;
      case 'folder': return <FolderOpen className={iconClass} />;
      case 'inbox':
      default:
        return <Inbox className={iconClass} />;
    }
  };

  if (variant === 'table-row') {
    return (
      <div className={cn(emptyStateVariants({ variant }), className)} {...props}>
        <p className="text-[var(--text-body)] text-muted-foreground">{description}</p>
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }

  return (
    <div className={cn(emptyStateVariants({ variant }), className)} {...props}>
      {renderIcon()}
      {title && <h3 className="text-[var(--text-group-title)] font-medium text-foreground mb-1">{title}</h3>}
      <p className="text-[var(--text-body)] text-muted-foreground max-w-sm mb-4">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
