import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { DetalleCalculo } from '@/lib/trazabilidad';

interface Props {
  detalle: DetalleCalculo;
  /** Lado al que se abre el popover. Por defecto se ancla a la izquierda del contenido. */
  align?: 'start' | 'center' | 'end';
  className?: string;
}

/**
 * Ícono ⓘ que abre un popover explicando cómo se calculó el valor que tiene al lado: qué representa,
 * con qué fórmula, qué datos se usaron y de qué período/fuente. Pensado para ir pegado a cada número
 * calculado de la ficha del cliente (trazabilidad pedida por los contadores).
 */
export function VerDetalle({ detalle, align = 'start', className }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver cómo se calcula: ${detalle.titulo}`}
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 normal-case tracking-normal text-left">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold">{detalle.titulo}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detalle.resumen}</p>
          </div>

          {detalle.formula && (
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed">
              <span className="text-muted-foreground">Cómo se calcula: </span>
              <span className="font-medium">{detalle.formula}</span>
            </div>
          )}

          {detalle.insumos && detalle.insumos.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Datos usados
              </div>
              <dl className="space-y-1">
                {detalle.insumos.map((ins, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-muted-foreground">
                      {ins.etiqueta}
                      {ins.nota && (
                        <span className="block text-[10px] text-muted-foreground/70">{ins.nota}</span>
                      )}
                    </dt>
                    <dd className="text-right font-medium tabular-nums">{ins.valor}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {detalle.glosario && detalle.glosario.length > 0 && (
            <dl className="space-y-2">
              {detalle.glosario.map((g, i) => (
                <div key={i} className="text-xs leading-relaxed">
                  <dt className="font-medium">{g.termino}</dt>
                  <dd className="text-muted-foreground">{g.detalle}</dd>
                </div>
              ))}
            </dl>
          )}

          {(detalle.periodo || detalle.fuente || detalle.nota) && (
            <div className="space-y-1 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              {detalle.periodo && (
                <div>
                  <span className="font-medium text-foreground/70">Período:</span> {detalle.periodo}
                </div>
              )}
              {detalle.fuente && (
                <div>
                  <span className="font-medium text-foreground/70">Origen:</span> {detalle.fuente}
                </div>
              )}
              {detalle.nota && <div>{detalle.nota}</div>}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
