/**
 * Configuración de los recordatorios de vencimiento (un solo bloque):
 *  - encabezado con el interruptor MAESTRO del estudio (envío automático on/off);
 *  - resumen compacto de la cartera;
 *  - lista de los clientes con vencimiento próximo, cada uno con su toggle para incluir/excluir el
 *    aviso sin entrar a la ficha.
 * Toda la funcionalidad es la de antes; sólo cambia la disposición.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  previsualizarVencimientos,
  editarCliente,
  type VencimientoCliente,
} from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import { qkClientes } from '@/lib/queries';
import { useConfig } from '@/context/ConfigContext';
import { formatCurrency } from '@/lib/utils';

const QK_PREVIEW = ['vencimientos', 'previsualizar'] as const;
const POR_PAGINA = 20;

function estadoDe(c: VencimientoCliente): { label: string; variant: 'success' | 'warning' | 'muted' } {
  if (!c.avisos_activos) return { label: 'Excluido', variant: 'muted' };
  if (!c.email) return { label: 'Falta email', variant: 'warning' };
  return { label: 'Le llega', variant: 'success' };
}

/** Interruptor reutilizable (maestro y por fila). `guardando` reemplaza el switch por un spinner. */
function Switch({
  activo,
  guardando,
  onToggle,
  label,
}: {
  activo: boolean;
  guardando?: boolean;
  onToggle: () => void;
  label: string;
}) {
  if (guardando) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        activo ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          activo ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

/** Un contador del resumen: punto de color + número + etiqueta. */
function Resumen({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="tabular-nums font-semibold">{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

export function PrevisualizacionVencimientos() {
  const qc = useQueryClient();
  const { config, guardarConfig } = useConfig();
  const masterActivo = config.vencimientos.activo;
  const [guardandoMaster, setGuardandoMaster] = useState(false);
  const [errorMaster, setErrorMaster] = useState('');
  const [guardandoCuit, setGuardandoCuit] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: QK_PREVIEW,
    queryFn: previsualizarVencimientos,
  });

  const toggleMaster = async () => {
    setGuardandoMaster(true);
    setErrorMaster('');
    try {
      await guardarConfig({ vencimientos: { activo: !masterActivo } });
    } catch (e) {
      setErrorMaster(mensajeDeError(e));
    } finally {
      setGuardandoMaster(false);
    }
  };

  const toggleCliente = async (c: VencimientoCliente) => {
    setGuardandoCuit(c.cuit);
    try {
      await editarCliente(c.cuit, { vencAvisos: !c.avisos_activos });
      await qc.invalidateQueries({ queryKey: QK_PREVIEW });
      qc.invalidateQueries({ queryKey: qkClientes });
    } finally {
      setGuardandoCuit(null);
    }
  };

  const conAviso = data?.clientes.filter((c) => c.avisos_activos) ?? [];
  const incluidos = conAviso.filter((c) => c.email).length;
  const sinEmail = conAviso.filter((c) => !c.email).length;
  const excluidos = (data?.clientes.length ?? 0) - conAviso.length;
  const rank = (c: VencimientoCliente) => (!c.avisos_activos ? 2 : !c.email ? 1 : 0);
  const clientes = [...(data?.clientes ?? [])].sort(
    (a, b) => rank(a) - rank(b) || a.nombre.localeCompare(b.nombre),
  );
  // Paginado (máx. 20 por página). paginaSegura evita quedar fuera de rango si la lista se achica.
  const totalPaginas = Math.ceil(clientes.length / POR_PAGINA);
  const paginaSegura = Math.min(pagina, Math.max(0, totalPaginas - 1));
  const desde = paginaSegura * POR_PAGINA;
  const visibles = clientes.slice(desde, desde + POR_PAGINA);

  return (
    <div className="space-y-4">
      {/* Encabezado + interruptor maestro del estudio */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold">Recordatorios de vencimiento</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md">
              Le avisamos por mail a cada cliente su próximo vencimiento, a principio de mes. Podés
              excluir a quien quieras con su interruptor.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`text-sm font-medium ${masterActivo ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {masterActivo ? 'Activado' : 'Desactivado'}
            </span>
            <Switch
              activo={masterActivo}
              guardando={guardandoMaster}
              onToggle={toggleMaster}
              label="Activar o desactivar el envío automático"
            />
          </div>
        </div>
        {errorMaster && <p className="mt-3 text-sm text-danger">{errorMaster}</p>}
      </Card>

      {isLoading ? (
        <Card className="flex items-center gap-2 p-7 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando cartera…
        </Card>
      ) : error || !data ? (
        <Card className="p-7">
          <p className="text-sm text-danger">No se pudo cargar la cartera.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Barra de resumen compacta */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border/60 px-5 py-3 text-sm">
            <span className="font-medium">{data.mes}</span>
            <Resumen color="bg-success" label="le llega" n={incluidos} />
            <Resumen color="bg-warning" label="sin email" n={sinEmail} />
            <Resumen color="bg-muted-foreground/40" label="excluidos" n={excluidos} />
            <Resumen color="bg-muted-foreground/40" label="sin vencimiento" n={data.sin_vencimiento_total} />
          </div>

          {clientes.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground max-w-prose mx-auto">
                Ninguno de tus clientes tiene un vencimiento próximo por ahora. Cuando aparezca, vas a
                poder gestionarlo desde acá.
              </p>
            </div>
          ) : (
            <>
              {/* Escritorio: tabla. Mobile (< lg): tarjetas. */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="w-[130px]">Estado</TableHead>
                      <TableHead className="w-[110px]">Vence</TableHead>
                      <TableHead className="text-right w-[150px]">Importe</TableHead>
                      <TableHead className="text-right w-[90px]">Aviso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((c) => {
                      const est = estadoDe(c);
                      return (
                        <TableRow key={c.cuit}>
                          <TableCell>
                            <div className="font-medium">{c.nombre}</div>
                            {c.email && (
                              <div className="text-xs text-muted-foreground">{c.email}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={est.variant}>{est.label}</Badge>
                          </TableCell>
                          <TableCell className="tabular-nums">{c.fecha}</TableCell>
                          <TableCell className="text-right">
                            {c.importe != null ? (
                              <span className="tabular-nums">{formatCurrency(c.importe)}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Solo fecha</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              <Switch
                                activo={c.avisos_activos}
                                guardando={guardandoCuit === c.cuit}
                                onToggle={() => toggleCliente(c)}
                                label={c.avisos_activos ? 'Desactivar recordatorio' : 'Activar recordatorio'}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-border/60 lg:hidden">
                {visibles.map((c) => {
                  const est = estadoDe(c);
                  return (
                    <div key={c.cuit} className="space-y-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{c.nombre}</div>
                          {c.email && (
                            <div className="text-xs text-muted-foreground break-all">{c.email}</div>
                          )}
                        </div>
                        <Switch
                          activo={c.avisos_activos}
                          guardando={guardandoCuit === c.cuit}
                          onToggle={() => toggleCliente(c)}
                          label={c.avisos_activos ? 'Desactivar recordatorio' : 'Activar recordatorio'}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge variant={est.variant}>{est.label}</Badge>
                        <span className="text-muted-foreground">
                          Vence <span className="tabular-nums text-foreground">{c.fecha}</span>
                          {c.importe != null && (
                            <>
                              {' · '}
                              <span className="tabular-nums text-foreground">
                                {formatCurrency(c.importe)}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalPaginas > 1 && (
                <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {desde + 1}–{desde + visibles.length} de {clientes.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagina((p) => Math.max(0, p - 1))}
                      disabled={paginaSegura === 0}
                    >
                      <ChevronLeft className="h-4 w-4" /> Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {paginaSegura + 1} / {totalPaginas}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
                      disabled={paginaSegura >= totalPaginas - 1}
                    >
                      Siguiente <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
