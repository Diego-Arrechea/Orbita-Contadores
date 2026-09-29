import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-xl border border-input bg-field px-3.5 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-[#d6e2ff] disabled:cursor-not-allowed disabled:opacity-50 transition',
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = 'Input';
