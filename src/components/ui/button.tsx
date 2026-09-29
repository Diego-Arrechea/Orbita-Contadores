import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-cta hover:bg-[hsl(224_74%_47%)]',
        destructive: 'bg-danger text-danger-foreground hover:bg-danger/90',
        outline: 'border border-input bg-card text-foreground hover:bg-muted/60',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-[#e8edf5]',
        ghost: 'text-accent-foreground hover:bg-field',
        link: 'text-primary underline-offset-4 hover:underline',
        soft: 'bg-accent text-accent-foreground hover:bg-accent/70',
      },
      size: {
        default: 'h-11 px-5 py-2',
        sm: 'h-9 rounded-full px-3.5 text-xs',
        lg: 'h-12 rounded-full px-7 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
