import { CheckCircle2, AlertTriangle, AlertCircle, Clock, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CAUSALES_EXCLUSION } from '@/data/causales';
import { formatDate, cn } from '@/lib/utils';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { HOY } from '@/lib/monotributo';
import type { Cliente, EstadoCausal } from '@/types';

interface Props {
  cliente: Cliente;
}

export function CausalesList({ cliente }: Props) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-5 border-b border-border/60">
        <div className="text-base font-semibold">Causales de exclusión del régimen</div>
        <p className="text-sm text-muted-foreground mt-1">
          El sistema monitorea las causales automáticas. Las manuales requieren tu verificación
          periódica.
        </p>
      </div>

      <div className="divide-y divide-border/60">
        {CAUSALES_EXCLUSION.map((c, idx) => {
          const estado = cliente.causales.find(ec => ec.codigo === c.codigo);
          if (!estado) return null;
          const diasSinVerificar = estado.ultimaVerificacion
            ? differenceInCalendarDays(HOY, parseISO(estado.ultimaVerificacion))
            : null;
          const sinVerificar = c.modo === 'manual' && (diasSinVerificar ?? 0) > 30;
          return (
            <div
              key={c.codigo}
              className={cn(
                'flex items-start gap-3 p-4 transition-colors',
                !estado.activa && 'opacity-50 bg-muted/20',
              )}
            >
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5',
                  estado.estado === 'ok' && !sinVerificar && 'bg-success/15 text-success',
                  estado.estado === 'riesgo' && 'bg-warning/20 text-warning-foreground',
                  estado.estado === 'superado' && 'bg-danger/15 text-danger',
                  (estado.estado === 'sin-verificar' || sinVerificar) &&
                    'bg-muted text-muted-foreground',
                )}
              >
                <IconoEstado estado={sinVerificar ? 'sin-verificar' : estado.estado} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium leading-tight">
                      <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                      {c.descripcion}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          c.modo === 'auto'
                            ? 'success'
                            : c.modo === 'parcial'
                              ? 'warning'
                              : 'muted'
                        }
                        className="text-[10px]"
                      >
                        {c.modo === 'auto'
                          ? 'Automático'
                          : c.modo === 'parcial'
                            ? 'Parcial'
                            : 'Manual'}
                      </Badge>
                      {!estado.activa && (
                        <Badge variant="muted" className="text-[10px]">
                          No aplica a este cliente
                        </Badge>
                      )}
                      {estado.ultimaVerificacion && c.modo === 'manual' && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Verificado el {formatDate(estado.ultimaVerificacion)}
                          {sinVerificar && (
                            <span className="text-warning-foreground ml-1">
                              ({diasSinVerificar} días)
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.modo === 'manual' && estado.activa && (
                    <Button size="sm" variant="outline">
                      Marcar verificada hoy
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 bg-muted/30 border-t border-border/60">
        <Separator className="mb-3" />
        <div className="text-xs text-muted-foreground">
          Las causales activadas se pueden modificar por cliente desde la configuración avanzada.
        </div>
      </div>
    </Card>
  );
}

function IconoEstado({ estado }: { estado: EstadoCausal }) {
  switch (estado) {
    case 'ok':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'riesgo':
      return <AlertTriangle className="h-4 w-4" />;
    case 'superado':
      return <AlertCircle className="h-4 w-4" />;
    case 'sin-verificar':
      return <Clock className="h-4 w-4" />;
  }
}
