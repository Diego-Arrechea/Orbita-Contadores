import { Progress } from '@/components/ui/progress';
import { formatPercent } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Props {
  porcentaje: number;
  className?: string;
  showLabel?: boolean;
}

export function ProgresoTope({ porcentaje, className, showLabel = true }: Props) {
  const pct = Math.min(porcentaje, 1.2);
  const value = Math.min(pct * 100, 100);
  const color =
    pct >= 1
      ? 'bg-danger'
      : pct >= 0.8
        ? 'bg-warning'
        : pct >= 0.6
          ? 'bg-primary'
          : 'bg-success';

  return (
    <div className={cn('w-full', className)}>
      <Progress value={value} indicatorClassName={color} className="h-1.5" />
      {showLabel && (
        <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {formatPercent(porcentaje, 1)}
        </div>
      )}
    </div>
  );
}
