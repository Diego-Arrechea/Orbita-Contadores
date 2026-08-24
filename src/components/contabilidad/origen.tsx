import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getOrigen, type Evento } from '@/services/contabilidadService';
import { mensajeDeError } from '@/services/authService';
import { formatCurrency, formatCuit } from '@/lib/utils';

/** Fecha ISO (con o sin hora) a dd/mm/aaaa, opcionalmente con la hora. */
export function fechaLegible(iso: string, conHora = false): string {
  if (!iso) return '—';
  const [fecha, resto] = iso.split('T');
  const dia = fecha.split('-').reverse().join('/');
  return conHora && resto ? `${dia} ${resto.slice(0, 5)}` : dia;
}

/** Una línea de la bitácora, lista para leer. */
export function LineaEvento({ evento }: { evento: Evento }) {
  return (
    <li className="flex flex-col gap-0.5 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{evento.etiqueta}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {fechaLegible(evento.fecha, true)}
        </span>
        {evento.usuario && (
          <span className="text-xs text-muted-foreground">· {evento.usuario}</span>
        )}
      </div>
      {evento.detalle && <span className="text-muted-foreground">{evento.detalle}</span>}
    </li>
  );
}

/**
 * De dónde sale un asiento: el comprobante con todos sus datos, el movimiento del extracto o la
 * carga manual que lo originó, más el historial de decisiones que se tomaron sobre él. Es el camino
 * de vuelta desde un número del balance hasta el papel.
 */
export function OrigenDialog({
  cuit,
  asientoId,
  onCerrar,
}: {
  cuit: string;
  /** null = cerrado. */
  asientoId: string | null;
  onCerrar: () => void;
}) {
  const { data: origen, isLoading, error } = useQuery({
    queryKey: ['contabilidad', 'origen', cuit, asientoId],
    queryFn: () => getOrigen(cuit, asientoId as string),
    enabled: !!cuit && !!asientoId,
  });

  const etiquetaTipo = {
    comprobante: 'Comprobante',
    banco: 'Movimiento del extracto',
    manual: 'Carga manual',
  };

  return (
    <Dialog open={!!asientoId} onOpenChange={v => !v && onCerrar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {isLoading || (!origen && !error) ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando el origen…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-destructive">{mensajeDeError(error)}</div>
        ) : origen ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {origen.titulo}
                <Badge variant="outline" className="text-xs font-normal">
                  {etiquetaTipo[origen.tipo]}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {origen.subtitulo}
                {origen.contraparte !== '—' && ` · ${origen.contraparte}`}
                {origen.contraparteCuit && ` · ${formatCuit(origen.contraparteCuit)}`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {origen.datos.map(d => (
                <div key={d.etiqueta} className="flex justify-between gap-3 py-1 text-sm">
                  <span className="text-muted-foreground">{d.etiqueta}</span>
                  <span className="text-right">{d.valor}</span>
                </div>
              ))}
            </div>

            <div className="border-t pt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Importes
              </div>
              <ul className="mt-1.5 divide-y">
                {origen.importes.map(i => (
                  <li key={i.etiqueta} className="flex justify-between gap-3 py-1.5 text-sm">
                    <span>{i.etiqueta}</span>
                    <span className="tabular-nums">{formatCurrency(i.importe)}</span>
                  </li>
                ))}
                {origen.percepciones.map(p => (
                  <li
                    key={p.etiqueta}
                    className="flex justify-between gap-3 py-1.5 text-sm text-muted-foreground"
                  >
                    <span>{p.etiqueta}</span>
                    <span className="tabular-nums">{formatCurrency(p.importe)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {origen.alicuotas.length > 0 && (
              <div className="border-t pt-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Discriminación del IVA
                </div>
                <ul className="mt-1.5 divide-y">
                  {origen.alicuotas.map(a => (
                    <li key={a.alicuota} className="flex justify-between gap-3 py-1.5 text-sm">
                      <span>{a.alicuota}</span>
                      <span className="tabular-nums text-muted-foreground">
                        base {formatCurrency(a.base)} · IVA {formatCurrency(a.iva)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t pt-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Qué se decidió sobre este asiento
              </div>
              {origen.historial.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Nadie lo tocó: se registró como lo propone Órbita.
                </p>
              ) : (
                <ul className="mt-1.5 divide-y">
                  {origen.historial.map(e => (
                    <LineaEvento key={e.id} evento={e} />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
