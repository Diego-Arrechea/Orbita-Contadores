import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

export function HistorialExtracciones({ cliente }: Props) {
  return (
    <Card className="overflow-hidden">
      <div className="p-5 border-b border-border/60">
        <div className="text-base font-semibold">Historial de sincronizaciones con ARCA</div>
        <p className="text-sm text-muted-foreground mt-1">
          Cada extracción exitosa actualiza la facturación de los últimos 13 meses.
        </p>
      </div>

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Nuevos</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Detalles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cliente.extracciones.map(e => (
              <TableRow key={e.id}>
                <TableCell className="font-medium tabular-nums">
                  {new Date(e.fecha).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell>
                  {e.resultado === 'exitosa' ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> Exitosa
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <AlertCircle className="h-3 w-3" /> Falló
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {e.resultado === 'exitosa' && typeof e.comprobantes === 'number' ? (
                    <span className="text-sm tabular-nums">
                      {e.comprobantes === 0 ? (
                        <span className="text-muted-foreground">Sin novedades</span>
                      ) : (
                        <>
                          {e.comprobantes}{' '}
                          <span className="text-muted-foreground">
                            nuevo{e.comprobantes === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {e.duracionMs ? (
                    <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(e.duracionMs / 1000).toFixed(1)}s
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {e.motivo ? (
                    <span className="text-sm text-danger">{e.motivo}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Facturación actualizada correctamente
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 p-4 lg:hidden">
        {cliente.extracciones.map(e => (
          <div key={e.id} className="rounded-xl border border-border/60 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              {e.resultado === 'exitosa' ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> Exitosa
                </Badge>
              ) : (
                <Badge variant="danger">
                  <AlertCircle className="h-3 w-3" /> Falló
                </Badge>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {new Date(e.fecha).toLocaleString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {e.resultado === 'exitosa' && typeof e.comprobantes === 'number' && (
                <span className="tabular-nums">
                  {e.comprobantes === 0
                    ? 'Sin novedades'
                    : `${e.comprobantes} nuevo${e.comprobantes === 1 ? '' : 's'}`}
                </span>
              )}
              {e.duracionMs && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {(e.duracionMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            <div className={cn('mt-1 text-xs', e.motivo ? 'text-danger' : 'text-muted-foreground')}>
              {e.motivo ? e.motivo : 'Facturación actualizada correctamente'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
