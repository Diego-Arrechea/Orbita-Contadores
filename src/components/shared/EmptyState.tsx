import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12 rounded-xl border border-dashed border-border bg-muted/20',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
        {icon}
      </div>
      <div className="font-medium">{title}</div>
      {description && (
        <div className="text-sm text-muted-foreground mt-1 max-w-md">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
