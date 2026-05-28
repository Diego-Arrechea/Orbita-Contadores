import { AlertCircle, AlertTriangle, HelpCircle, CheckCircle2 } from 'lucide-react';
import type { EstadoAlerta } from '@/types';
import { cn } from '@/lib/utils';

const config: Record<
  EstadoAlerta,
  { label: string; icon: typeof AlertCircle; classes: string }
> = {
  rojo: {
    label: 'Acción urgente',
    icon: AlertCircle,
    classes: 'bg-danger/10 text-danger',
  },
  amarillo: {
    label: 'Monitoreo activo',
    icon: AlertTriangle,
    classes: 'bg-warning/20 text-warning-foreground',
  },
  gris: {
    label: 'Problema de datos',
    icon: HelpCircle,
    classes: 'bg-muted text-muted-foreground',
  },
  verde: {
    label: 'Sin alertas',
    icon: CheckCircle2,
    classes: 'bg-success/10 text-success',
  },
};

interface Props {
  estado: EstadoAlerta;
  compact?: boolean;
  className?: string;
}

export function AlertaBadge({ estado, compact, className }: Props) {
  const { label, icon: Icon, classes } = config[estado];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        classes,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {!compact && label}
    </span>
  );
}

export function SemaforoDot({ estado, className }: { estado: EstadoAlerta; className?: string }) {
  const colors: Record<EstadoAlerta, string> = {
    rojo: 'bg-danger',
    amarillo: 'bg-warning',
    gris: 'bg-muted-foreground/40',
    verde: 'bg-success',
  };
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background',
        colors[estado],
        className,
      )}
    />
  );
}
