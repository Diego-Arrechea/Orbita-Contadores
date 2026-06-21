import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from './input';
import { cn } from '@/lib/utils';

/**
 * Input de contraseña con botón de "ojito" para ver/ocultar. Reenvía todas las props del Input
 * (value, onChange, id, autoComplete, placeholder, etc.); sólo gobierna el `type`.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ className, ...props }, ref) => {
    const [ver, setVer] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={ver ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVer(v => !v)}
          aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';
