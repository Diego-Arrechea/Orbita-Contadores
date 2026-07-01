import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Paperclip, RefreshCcw, AlertTriangle, Inbox } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useComunicaciones, qkComunicaciones } from '@/lib/queries';
import {
  sincronizarComunicaciones,
  marcarComunicacionVista,
  type Comunicacion,
} from '@/services/comunicacionesService';
import { cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function DomicilioElectronico({ cliente }: Props) {
  const esReal = cliente.fuente === 'arca';
  const queryClient = useQueryClient();
  const { data: comunicaciones = [], isLoading } = useComunicaciones(cliente.cuit, esReal);

  const [refrescando, setRefrescando] = useState(false);
  const [abierta, setAbierta] = useState<Comunicacion | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: qkComunicaciones(cliente.cuit) });

  const refrescar = async () => {
    setRefrescando(true);
    try {
      await sincronizarComunicaciones(cliente.cuit);
      await invalidar();
    } catch (e) {
      console.error('No se pudieron actualizar las comunicaciones', e);
    } finally {
      setRefrescando(false);
    }
  };

  // Abrir una comunicación: la mostramos al toque (con lo que ya tengamos) y en paralelo la marcamos
  // vista (baja el detalle completo y apaga el punto rojo).
  const abrir = async (c: Comunicacion) => {
    setAbierta(c);
    if (c.vista && c.detalle) return; // ya la teníamos completa
    setCargandoDetalle(true);
    try {
      const actualizada = await marcarComunicacionVista(cliente.cuit, c.id);
      setAbierta(actualizada);
      await invalidar();
    } catch (e) {
      console.error('No se pudo abrir la comunicación', e);
    } finally {
      setCargandoDetalle(false);
    }
  };

  const sinVer = comunicaciones.filter(c => !c.vista).length;

  if (!esReal) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        El Domicilio Fiscal Electrónico está disponible para clientes reales.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="p-5 border-b border-border/60 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold flex items-center gap-2">
            Domicilio Fiscal Electrónico
            {sinVer > 0 && (
              <Badge variant="danger" className="rounded-full">
                {sinVer} sin ver
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Comunicaciones oficiales dirigidas al contribuyente. Abrí cada una para leerla; queda
            marcada como leída.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refrescar} disabled={refrescando}>
          <RefreshCcw className={cn('h-4 w-4', refrescando && 'animate-spin')} />
          {refrescando ? 'Actualizando…' : 'Actualizar'}
        </Button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Cargando comunicaciones…</div>
      ) : comunicaciones.length === 0 ? (
        <div className="p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <div className="mt-3 text-sm font-medium">Sin comunicaciones</div>
          <p className="text-sm text-muted-foreground mt-1">
            Este contribuyente no tiene comunicaciones registradas.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {comunicaciones.map(c => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void abrir(c)}
                className="w-full text-left px-4 sm:px-5 py-3.5 flex items-start gap-3 hover:bg-accent/40 transition-colors"
              >
                {/* Punto rojo: comunicación sin ver por el contador. */}
                <span className="mt-1.5 shrink-0">
                  {!c.vista ? (
                    <span className="block h-2.5 w-2.5 rounded-full bg-danger" title="Sin ver" />
                  ) : (
                    <Mail className="h-4 w-4 text-muted-foreground/50" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-sm', !c.vista ? 'font-semibold' : 'text-foreground')}>
                      {c.organismo || c.sistema || 'Comunicación'}
                    </span>
                    {c.tieneAdjunto && (
                      <Badge variant="muted" className="gap-1">
                        <Paperclip className="h-3 w-3" /> Adjunto
                      </Badge>
                    )}
                    {c.prioridad && /alta|urgente/i.test(c.prioridad) && (
                      <Badge variant="danger" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> {c.prioridad}
                      </Badge>
                    )}
                  </div>
                  {c.asunto && (
                    <div className="text-sm text-muted-foreground mt-0.5 line-clamp-1">
                      {c.asunto}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground tabular-nums pt-0.5">
                  {fechaCorta(c.fechaPublicacion)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!abierta} onOpenChange={o => !o && setAbierta(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{abierta?.organismo || abierta?.sistema || 'Comunicación'}</DialogTitle>
            <DialogDescription>
              Publicada el {fechaCorta(abierta?.fechaPublicacion ?? null)}
              {abierta?.fechaVencimiento
                ? ` · Vence el ${fechaCorta(abierta.fechaVencimiento)}`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto text-sm">
            {cargandoDetalle && !abierta?.detalle ? (
              <div className="py-6 text-center text-muted-foreground">Abriendo comunicación…</div>
            ) : (
              <div className="whitespace-pre-wrap leading-relaxed">
                {abierta?.detalle || abierta?.asunto || 'Sin contenido disponible.'}
              </div>
            )}
            {abierta?.tieneAdjunto && (
              <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-muted-foreground inline-flex items-center gap-2">
                <Paperclip className="h-4 w-4" /> Posee archivo adjunto
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
