import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Calendar,
  RefreshCcw,
  Pencil,
  Trash2,
  FileText,
  MoreVertical,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AlertaBadge } from '@/components/shared/AlertaBadge';
import { SituacionActual } from '@/components/cliente/SituacionActual';
import { EstadoCuenta } from '@/components/cliente/EstadoCuenta';
import { HistoricoMensual } from '@/components/cliente/HistoricoMensual';
import { ReconciliacionBancaria } from '@/components/cliente/ReconciliacionBancaria';
import { ListaComprobantes } from '@/components/cliente/ListaComprobantes';
// import { CausalesList } from '@/components/cliente/CausalesList'; // oculto por ahora (ver tab "causales")
import { NotasContador } from '@/components/cliente/NotasContador';
import { HistorialExtracciones } from '@/components/cliente/HistorialExtracciones';
import { getCliente } from '@/data/clientes';
import { useConfig } from '@/context/ConfigContext';
import { calcularCliente } from '@/lib/monotributo';
import { esMonotributista, etiquetaRegimen } from '@/lib/regimen';
import { formatCuit, formatDate, cn } from '@/lib/utils';
import { useSync } from '@/context/SyncContext';
import { getClienteReal } from '@/services/clientesService';
import { EditarClienteDialog } from '@/components/cliente/EditarClienteDialog';
import { EliminarClienteDialog } from '@/components/cliente/EliminarClienteDialog';
import type { Cliente } from '@/types';

const tabsListClass =
  'bg-transparent p-0 h-auto rounded-none gap-7 overflow-x-auto scrollbar-thin justify-start';

const tabTriggerClass =
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground rounded-none px-0 py-3.5 text-muted-foreground hover:text-foreground transition-colors';

export function ClienteDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clienteMock = id ? getCliente(id) : undefined;
  const [clienteReal, setClienteReal] = useState<Cliente | null>(null);
  const [buscandoReal, setBuscandoReal] = useState(!clienteMock);
  const [editarOpen, setEditarOpen] = useState(false);
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const { config } = useConfig();

  // Carga (o recarga) el cliente real COMPLETO: trae sus comprobantes y recalcula todo lo derivado
  // (situación, histórico, causales). Una sola fuente de verdad, reusada en montaje y al sincronizar.
  const cargarClienteReal = useCallback(
    async (silencioso = false) => {
      if (clienteMock || !id) return;
      if (!silencioso) setBuscandoReal(true);
      try {
        // No vaciamos clienteReal antes: así la ficha no parpadea mientras recarga.
        setClienteReal(await getClienteReal(id));
      } finally {
        if (!silencioso) setBuscandoReal(false);
      }
    },
    [clienteMock, id],
  );

  useEffect(() => {
    if (clienteMock || !id) {
      setBuscandoReal(false);
      return;
    }
    void cargarClienteReal();
  }, [clienteMock, id, cargarClienteReal]);

  // El backend ya aplica las ediciones del contador sobre el dato de ARCA; el front sólo elige mock o
  // real. Al guardar una edición se re-trae el cliente con cargarClienteReal (ver onGuardado).
  const cliente = useMemo(
    () => clienteMock ?? clienteReal ?? undefined,
    [clienteMock, clienteReal],
  );

  const esReal = cliente?.fuente === 'arca';
  const cuit = cliente?.cuit;

  // La sincronización corre en SEGUNDO PLANO (SyncContext): sigue aunque el contador se vaya de la
  // ficha, y se ve en el indicador del header. Acá sólo la disparamos y leemos su estado.
  const { sincronizar, estaSincronizando, syncs } = useSync();
  const sincronizando = !!cuit && estaSincronizando(cuit);
  const miSync = cuit ? syncs.find(s => s.cuit === cuit.replace(/\D/g, '')) : undefined;
  const errorSync = miSync?.estado === 'error' ? miSync.error : null;

  const handleSincronizar = useCallback(() => {
    if (!esReal || !cuit) return;
    sincronizar(cuit, cliente?.nombre ?? cuit);
  }, [esReal, cuit, cliente?.nombre, sincronizar]);

  // Al terminar la sincronización de ESTE cliente, recargamos su ficha (comprobantes + derivados).
  const sincRef = useRef(sincronizando);
  useEffect(() => {
    if (sincRef.current && !sincronizando) void cargarClienteReal(true);
    sincRef.current = sincronizando;
  }, [sincronizando, cargarClienteReal]);

  if (!cliente) {
    return (
      <div className="text-center py-12">
        <div className="font-medium">
          {buscandoReal ? 'Cargando cliente…' : 'Cliente no encontrado'}
        </div>
        {!buscandoReal && (
          <Button asChild className="mt-3" variant="outline">
            <Link to="/">Volver al dashboard</Link>
          </Button>
        )}
      </div>
    );
  }

  const calc = calcularCliente(cliente, config.ventanas, config.inflacionMensualProyeccion);

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/')}
        className="-ml-3 -mb-2 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Volver al dashboard
      </Button>

      <Tabs defaultValue="situacion" className="space-y-5">
        <Card className="overflow-hidden p-0 border-primary/15">
          <div
            className="p-7 relative"
            style={{
              background:
                'linear-gradient(135deg, hsl(var(--primary) / 0.16) 0%, hsl(var(--accent) / 0.6) 38%, hsl(var(--card)) 100%)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent)',
              }}
            />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-5">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-semibold shrink-0 shadow-md">
                  {cliente.nombre
                    .split(' ')
                    .map(p => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
                    <Badge variant="outline" className="font-semibold bg-card/70">
                      {esMonotributista(cliente)
                        ? `Cat. ${cliente.categoria}`
                        : etiquetaRegimen(cliente.regimen)}
                    </Badge>
                    <Badge variant="muted" className="capitalize bg-card/70">
                      {cliente.tipoActividad}
                    </Badge>
                    <AlertaBadge estado={cliente.estadoAlerta} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground flex-wrap">
                    <span className="tabular-nums">CUIT {formatCuit(cliente.cuit)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Datos desde {formatDate(cliente.fechaInicio, 'long')}
                    </span>
                    {cliente.ultimaExtraccion && (
                      <span className="inline-flex items-center gap-1.5">
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Última sync {formatDate(cliente.ultimaExtraccion)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-card/70 backdrop-blur"
                  onClick={handleSincronizar}
                  disabled={!esReal || sincronizando}
                  title={esReal ? 'Traer los últimos comprobantes de ARCA' : 'Solo para clientes conectados a ARCA'}
                >
                  <RefreshCcw className={cn('h-3.5 w-3.5', sincronizando && 'animate-spin')} />
                  {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-card/70 backdrop-blur px-2"
                      title="Más acciones"
                      aria-label="Más acciones"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={`/clientes/${cliente.id}/reporte`}>
                        <FileText /> Reporte
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTimeout(() => setEditarOpen(true), 0)}>
                      <Pencil /> Editar
                    </DropdownMenuItem>
                    {esReal && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-danger focus:bg-danger/10 focus:text-danger"
                          onSelect={() => setTimeout(() => setEliminarOpen(true), 0)}
                        >
                          <Trash2 /> Eliminar
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Diálogos controlados desde el menú (sin trigger propio) */}
                <EditarClienteDialog
                  cliente={cliente}
                  onGuardado={() => void cargarClienteReal(true)}
                  open={editarOpen}
                  onOpenChange={setEditarOpen}
                />
                {esReal && (
                  <EliminarClienteDialog
                    cliente={cliente}
                    onEliminado={() => navigate('/')}
                    open={eliminarOpen}
                    onOpenChange={setEliminarOpen}
                  />
                )}
              </div>
            </div>

            {cliente.resultadoUltimaExtraccion === 'fallida' &&
              cliente.motivoFalloUltimaExtraccion && (
                <div className="mt-5 rounded-lg bg-danger/12 border border-danger/25 px-4 py-2.5 text-sm">
                  <span className="text-danger font-medium">
                    Última sincronización falló:
                  </span>
                  <span className="text-foreground/80 ml-2">
                    {cliente.motivoFalloUltimaExtraccion}
                  </span>
                </div>
              )}

            {errorSync && (
              <div className="mt-5 rounded-lg bg-danger/12 border border-danger/25 px-4 py-2.5 text-sm">
                <span className="text-danger font-medium">No se pudo sincronizar:</span>
                <span className="text-foreground/80 ml-2">{errorSync}</span>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 bg-card/70 px-7">
            <TabsList className={tabsListClass}>
              <TabsTrigger value="situacion" className={tabTriggerClass}>Situación actual</TabsTrigger>
              <TabsTrigger value="estado-cuenta" className={tabTriggerClass}>Estado de cuenta</TabsTrigger>
              <TabsTrigger value="historico" className={tabTriggerClass}>Histórico mensual</TabsTrigger>
              <TabsTrigger value="reconciliacion" className={tabTriggerClass}>Reconciliación bancaria</TabsTrigger>
              <TabsTrigger value="comprobantes" className={tabTriggerClass}>Comprobantes</TabsTrigger>
              {/* Causales de exclusión: oculta por ahora (vacía para clientes reales). Reactivar cuando un contador la pida. */}
              {/* <TabsTrigger value="causales" className={tabTriggerClass}>Causales de exclusión</TabsTrigger> */}
              <TabsTrigger value="notas" className={tabTriggerClass}>Notas y extracciones</TabsTrigger>
            </TabsList>
          </div>
        </Card>

        <TabsContent value="situacion" className="mt-0">
          <SituacionActual cliente={cliente} calc={calc} />
        </TabsContent>
        <TabsContent value="estado-cuenta" className="mt-0">
          <EstadoCuenta cliente={cliente} />
        </TabsContent>
        <TabsContent value="historico" className="mt-0">
          <HistoricoMensual cliente={cliente} />
        </TabsContent>
        <TabsContent value="reconciliacion" className="mt-0">
          <ReconciliacionBancaria cliente={cliente} />
        </TabsContent>
        <TabsContent value="comprobantes" className="mt-0">
          <ListaComprobantes cliente={cliente} />
        </TabsContent>
        {/* <TabsContent value="causales" className="mt-0">
          <CausalesList cliente={cliente} />
        </TabsContent> */}
        <TabsContent value="notas" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <NotasContador cliente={cliente} />
            <HistorialExtracciones cliente={cliente} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
