import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Loader2, Pause, Pencil, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProgramarReporte } from '@/components/cliente/ProgramarReporte';
import { mensajeDeError } from '@/services/authService';
import {
  borrarReporteProgramado,
  cambiarEstadoReporteProgramado,
  describirProgramacion,
  fechaHoraAR,
  getReportesProgramados,
  type ReporteProgramado,
} from '@/services/reportesProgramadosService';

const QK = ['reportes-programados'];

/** Envíos programados del reporte por mail: cuándo sale cada uno, a quién y cómo le fue al último. */
export function ReportesProgramados() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: getReportesProgramados });
  // null = cerrado · 'nuevo' = programar uno nuevo · ReporteProgramado = editar ese.
  const [editando, setEditando] = useState<ReporteProgramado | 'nuevo' | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refrescar = () => qc.invalidateQueries({ queryKey: QK });
  async function accion(id: number, fn: () => Promise<unknown>) {
    setOcupado(id);
    setError(null);
    try {
      await fn();
      await refrescar();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Envíos programados</h1>
          <p className="text-base text-muted-foreground mt-2">
            Reportes que salen solos por mail, una vez o todos los meses o semanas. Cada cliente recibe el
            suyo, armado con los datos del día del envío.
          </p>
        </div>
        <Button onClick={() => setEditando('nuevo')}>
          <Plus className="mr-2 h-4 w-4" /> Programar envío
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !data?.length ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 h-6 w-6" />
          Todavía no programaste envíos. Podés hacerlo acá o desde la ficha de un cliente, en «Enviar reporte».
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map(p => {
            const fallidos = p.ultimo_resultado?.filter(r => !r.ok) ?? [];
            const enviados = (p.ultimo_resultado?.length ?? 0) - fallidos.length;
            return (
              <Card key={p.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{describirProgramacion(p)}</span>
                      {!p.activo && <Badge variant="secondary">{p.proximo_envio ? 'Pausado' : 'Terminado'}</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {p.activo && p.proximo_envio ? `Próximo envío: ${fechaHoraAR(p.proximo_envio)}` : 'Sin envíos pendientes'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.destinos.map(d => (
                        <Link
                          key={d.cuit}
                          to={`/clientes/${d.cuit}`}
                          className="rounded-full border border-border/60 px-2 py-0.5 text-xs hover:border-primary/40"
                          title={d.destino}
                        >
                          {d.nombre} <span className="text-muted-foreground">· {d.destino}</span>
                        </Link>
                      ))}
                    </div>
                    {p.ultimo_envio_en && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Último envío {fechaHoraAR(p.ultimo_envio_en)}:{' '}
                        {enviados > 0 && (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> {enviados} enviado{enviados === 1 ? '' : 's'}
                          </span>
                        )}
                        {fallidos.map(f => (
                          <span key={f.cuit} className="ml-2 inline-flex items-center gap-1 text-danger">
                            <XCircle className="h-3 w-3" /> {f.nombre}: {f.error}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {(p.activo || p.proximo_envio || p.frecuencia !== 'unica') && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado === p.id}
                        onClick={() => accion(p.id, () => cambiarEstadoReporteProgramado(p.id, !p.activo))}
                      >
                        {p.activo ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                        {p.activo ? 'Pausar' : 'Reanudar'}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditando(p)} aria-label="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado === p.id}
                      aria-label="Borrar"
                      onClick={() => {
                        if (window.confirm('¿Borrar este envío programado?')) {
                          void accion(p.id, () => borrarReporteProgramado(p.id));
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editando !== null} onOpenChange={o => !o && setEditando(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando === 'nuevo' ? 'Programar envío del reporte' : 'Editar envío programado'}</DialogTitle>
            <DialogDescription>
              A cada cliente le llega su reporte, con sus opciones de reporte y los datos del día del envío.
            </DialogDescription>
          </DialogHeader>
          {editando !== null && (
            <ProgramarReporte
              inicial={[]}
              programacion={editando === 'nuevo' ? undefined : editando}
              onCancelar={() => setEditando(null)}
              onGuardado={() => {
                setEditando(null);
                void refrescar();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
