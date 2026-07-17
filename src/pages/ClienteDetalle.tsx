import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Calendar,
  RefreshCcw,
  Pencil,
  Trash2,
  FileText,
  FileSpreadsheet,
  FilePlus2,
  UserPlus,
  MoreVertical,
  KeyRound,
  Wheat,
  Briefcase,
  Power,
  ScrollText,
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
import { FacturacionDetalle } from '@/components/cliente/FacturacionDetalle';
import { FacturacionAgropecuaria } from '@/components/cliente/FacturacionAgropecuaria';
import { RelacionDependencia } from '@/components/cliente/RelacionDependencia';
import { ReconciliacionBancaria } from '@/components/cliente/ReconciliacionBancaria';
import { ListaComprobantes } from '@/components/cliente/ListaComprobantes';
// import { CausalesList } from '@/components/cliente/CausalesList'; // oculto por ahora (ver tab "causales")
import { NotasContador } from '@/components/cliente/NotasContador';
import { HistorialExtracciones } from '@/components/cliente/HistorialExtracciones';
import { DomicilioElectronico } from '@/components/cliente/DomicilioElectronico';
import { getCliente } from '@/data/clientes';
import { useConfig } from '@/context/ConfigContext';
import { calcularCliente } from '@/lib/monotributo';
import { esMonotributista, etiquetaRegimen } from '@/lib/regimen';
import { formatCuit, formatDate, cn } from '@/lib/utils';
import { derivarAlertas } from '@/lib/alertas';
import { descargarReporteExcel } from '@/lib/reporteExcel';
import { puedeFacturar, tienePermiso } from '@/lib/cuenta';
import { getMovimientos } from '@/services/movimientosService';
import { useQueryClient } from '@tanstack/react-query';
import { useClienteReal, useComunicaciones, qkClientes } from '@/lib/queries';
import { cambiarActivoCliente, getConstanciaBlob } from '@/services/clientesService';
import { EditarClienteDialog } from '@/components/cliente/EditarClienteDialog';
import { CambiarClaveDialog } from '@/components/cliente/CambiarClaveDialog';
import { EliminarClienteDialog } from '@/components/cliente/EliminarClienteDialog';
import { EmitirComprobanteDialog } from '@/components/cliente/EmitirComprobanteDialog';

const tabsListClass =
  'flex w-full bg-transparent p-0 h-auto rounded-none gap-5 sm:gap-7 overflow-x-auto scrollbar-thin justify-start';

const tabTriggerClass =
  'shrink-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground rounded-none px-0 py-3.5 text-muted-foreground hover:text-foreground transition-colors';

export function ClienteDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clienteMock = id ? getCliente(id) : undefined;
  // Cliente real cacheado (React Query); comparte cache con el reporte (misma key). El refetch (al
  // editar) mantiene visibles los datos previos mientras recarga, sin parpadeo. `enabled` evita
  // pedir cuando se usa el mock. El InvalidadorCache global lo re-trae al terminar su sincronización.
  const { data: clienteReal = null, isLoading: buscandoReal, refetch: refetchCliente } =
    useClienteReal(id, !clienteMock);
  // Comunicaciones del Domicilio Fiscal Electrónico (para el punto rojo del tab). Comparte cache con
  // el tab; sólo se pide para clientes reales.
  const { data: comunicaciones = [] } = useComunicaciones(id, !clienteMock);
  const comunicacionesSinVer = comunicaciones.filter(c => !c.vista).length;
  const [editarOpen, setEditarOpen] = useState(false);
  const [claveOpen, setClaveOpen] = useState(false);
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const [tab, setTab] = useState('situacion');
  const [generandoExcel, setGenerandoExcel] = useState(false);
  const [facturarOpen, setFacturarOpen] = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);
  const [constanciaCargando, setConstanciaCargando] = useState(false);
  const queryClient = useQueryClient();
  const { config, inflacionEfectiva } = useConfig();

  // El backend ya aplica las ediciones del contador sobre el dato de ARCA; el front sólo elige mock o
  // real. Al guardar una edición se re-trae el cliente con cargarClienteReal (ver onGuardado).
  const cliente = useMemo(
    () => clienteMock ?? clienteReal ?? undefined,
    [clienteMock, clienteReal],
  );

  const esReal = cliente?.fuente === 'arca';
  const facturarHabilitado = esReal && puedeFacturar();
  const clienteActivo = cliente?.activo !== false; // undefined (mock) = activo

  // Prende/apaga el monitoreo del cliente. Al desactivarlo deja de actualizarse su información y en
  // la lista aparece atenuado; los datos ya guardados se conservan. Reversible en cualquier momento.
  const alternarActivo = async () => {
    if (!cliente || !esReal) return;
    setCambiandoActivo(true);
    try {
      await cambiarActivoCliente(cliente.cuit, !clienteActivo);
      await queryClient.invalidateQueries({ queryKey: qkClientes });
      void refetchCliente();
    } finally {
      setCambiandoActivo(false);
    }
  };

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

  const calc = calcularCliente(cliente, config.ventanas, inflacionEfectiva);

  // Descarga el papel de trabajo del cliente en Excel. Para clientes reales trae los movimientos del
  // backend (para el bloque "pendientes de respaldo"); para los mock usa los embebidos.
  const descargarExcel = async () => {
    setGenerandoExcel(true);
    try {
      const movimientos = esReal
        ? await getMovimientos(cliente.cuit)
        : (cliente.movimientosBancarios ?? []);
      const alertas = derivarAlertas(cliente, calc, config);
      descargarReporteExcel({ cliente, calc, alertas, movimientos });
    } catch (e) {
      console.error('No se pudo generar el Excel del cliente', e);
    } finally {
      setGenerandoExcel(false);
    }
  };

  // Abre la constancia de inscripción oficial del cliente en una pestaña nueva, lista para
  // imprimir/guardar en PDF. Se trae en vivo (tarda unos segundos): abrimos la pestaña YA —en el
  // gesto del click— para que el navegador no la bloquee como popup, y la completamos al llegar.
  const abrirConstancia = async () => {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(
        '<p style="font-family:system-ui,sans-serif;padding:2rem;color:#334">Generando la constancia…</p>',
      );
    }
    setConstanciaCargando(true);
    try {
      const blob = await getConstanciaBlob(cliente.cuit);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      console.error('No se pudo obtener la constancia', e);
      if (win) {
        win.document.body.innerHTML =
          '<p style="font-family:system-ui,sans-serif;padding:2rem;color:#334">No se pudo obtener la constancia en este momento. Cerrá esta pestaña y probá de nuevo en unos minutos.</p>';
      }
    } finally {
      setConstanciaCargando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 -mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="-ml-3 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Volver al dashboard
        </Button>
        {tienePermiso('nuevo_cliente') && (
          <Button variant="outline" size="sm" onClick={() => navigate('/clientes/nuevo')}>
            <UserPlus className="h-4 w-4" /> Agregar otro cliente
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <Card className="overflow-hidden p-0 border-primary/15">
          <div
            className="p-4 sm:p-7 relative"
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 sm:gap-5 min-w-0">
                <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-base sm:text-xl font-semibold shrink-0 shadow-md">
                  {cliente.nombre
                    .split(' ')
                    .map(p => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-lg sm:text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
                    <Badge variant="outline" className="font-semibold bg-card/70">
                      {esMonotributista(cliente)
                        ? `Cat. ${cliente.categoria}`
                        : etiquetaRegimen(cliente.regimen)}
                    </Badge>
                    <Badge variant="muted" className="capitalize bg-card/70">
                      {cliente.tipoActividad}
                    </Badge>
                    <AlertaBadge estado={cliente.estadoAlerta} />
                    {!clienteActivo && (
                      <Badge variant="muted" className="font-semibold text-muted-foreground">
                        Desactivado
                      </Badge>
                    )}
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

              <div className="flex items-center gap-2 shrink-0">
                {facturarHabilitado && (
                  <Button
                    size="sm"
                    onClick={() => setFacturarOpen(true)}
                    className="shrink-0"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    {cliente.tieneFacturacion ? 'Emitir comprobante' : 'Habilitar facturación'}
                  </Button>
                )}
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
                        <FileText /> Reporte (PDF)
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={generandoExcel}
                      onSelect={e => {
                        e.preventDefault();
                        void descargarExcel();
                      }}
                    >
                      <FileSpreadsheet /> {generandoExcel ? 'Generando Excel…' : 'Descargar Excel'}
                    </DropdownMenuItem>
                    {esReal && (
                      <DropdownMenuItem
                        disabled={constanciaCargando}
                        onSelect={e => {
                          e.preventDefault();
                          void abrirConstancia();
                        }}
                      >
                        <ScrollText />{' '}
                        {constanciaCargando ? 'Generando constancia…' : 'Constancia de inscripción'}
                      </DropdownMenuItem>
                    )}
                    {tienePermiso('editar_cliente') && (
                      <DropdownMenuItem onSelect={() => setTimeout(() => setEditarOpen(true), 0)}>
                        <Pencil /> Editar
                      </DropdownMenuItem>
                    )}
                    {esReal && tienePermiso('actualizar_clave') && (
                      <DropdownMenuItem onSelect={() => setTimeout(() => setClaveOpen(true), 0)}>
                        <KeyRound /> Actualizar clave fiscal
                      </DropdownMenuItem>
                    )}
                    {esReal && tienePermiso('editar_cliente') && (
                      <DropdownMenuItem
                        disabled={cambiandoActivo}
                        onSelect={() => void alternarActivo()}
                      >
                        <Power /> {clienteActivo ? 'Desactivar cliente' : 'Activar cliente'}
                      </DropdownMenuItem>
                    )}
                    {esReal && tienePermiso('eliminar_cliente') && (
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
                  onGuardado={() => void refetchCliente()}
                  open={editarOpen}
                  onOpenChange={setEditarOpen}
                />
                {esReal && (
                  <CambiarClaveDialog
                    cliente={cliente}
                    onGuardado={() => void refetchCliente()}
                    open={claveOpen}
                    onOpenChange={setClaveOpen}
                  />
                )}
                {esReal && (
                  <EliminarClienteDialog
                    cliente={cliente}
                    onEliminado={() => navigate('/')}
                    open={eliminarOpen}
                    onOpenChange={setEliminarOpen}
                  />
                )}
                {facturarHabilitado && (
                  <EmitirComprobanteDialog
                    cliente={cliente}
                    open={facturarOpen}
                    onOpenChange={o => {
                      setFacturarOpen(o);
                      if (!o) void refetchCliente(); // refresca tieneFacturacion: el botón pasa de Habilitar→Emitir
                    }}
                    onEmitido={() => void refetchCliente()}
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
          </div>

          <div className="border-t border-border/60 bg-card/70 px-4 sm:px-7">
            <TabsList className={tabsListClass}>
              <TabsTrigger value="situacion" className={tabTriggerClass}>Situación actual</TabsTrigger>
              <TabsTrigger value="estado-cuenta" className={tabTriggerClass}>Estado de cuenta</TabsTrigger>
              <TabsTrigger value="historico" className={tabTriggerClass}>Histórico mensual</TabsTrigger>
              <TabsTrigger value="facturacion" className={tabTriggerClass}>Facturación 12m</TabsTrigger>
              {cliente.facturaAgro && (
                <TabsTrigger
                  value="agro"
                  className={cn(tabTriggerClass, 'inline-flex items-center gap-1.5')}
                >
                  <Wheat className="h-3.5 w-3.5" /> Facturación agropecuaria
                </TabsTrigger>
              )}
              {cliente.relacionDependencia && (
                <TabsTrigger
                  value="relacion-dependencia"
                  className={cn(tabTriggerClass, 'inline-flex items-center gap-1.5')}
                >
                  <Briefcase className="h-3.5 w-3.5" /> Relación de dependencia
                </TabsTrigger>
              )}
              <TabsTrigger value="reconciliacion" className={tabTriggerClass}>Reconciliación bancaria</TabsTrigger>
              <TabsTrigger value="comprobantes" className={tabTriggerClass}>Comprobantes</TabsTrigger>
              <TabsTrigger value="dfe" className={cn(tabTriggerClass, 'inline-flex items-center gap-1.5')}>
                Domicilio Fiscal Electrónico
                {comunicacionesSinVer > 0 && (
                  <span
                    className="h-2 w-2 rounded-full bg-danger"
                    title={`${comunicacionesSinVer} comunicación(es) sin ver`}
                  />
                )}
              </TabsTrigger>
              {/* Causales de exclusión: oculta por ahora (vacía para clientes reales). Reactivar cuando un contador la pida. */}
              {/* <TabsTrigger value="causales" className={tabTriggerClass}>Causales de exclusión</TabsTrigger> */}
              <TabsTrigger value="notas" className={tabTriggerClass}>Notas y extracciones</TabsTrigger>
            </TabsList>
          </div>
        </Card>

        <TabsContent value="situacion" className="mt-0">
          <SituacionActual
            cliente={cliente}
            calc={calc}
            onVerComprobantes={() => setTab('facturacion')}
          />
        </TabsContent>
        <TabsContent value="estado-cuenta" className="mt-0">
          <EstadoCuenta cliente={cliente} />
        </TabsContent>
        <TabsContent value="historico" className="mt-0">
          <HistoricoMensual cliente={cliente} />
        </TabsContent>
        <TabsContent value="facturacion" className="mt-0">
          <FacturacionDetalle cliente={cliente} />
        </TabsContent>
        {cliente.facturaAgro && (
          <TabsContent value="agro" className="mt-0">
            <FacturacionAgropecuaria cliente={cliente} />
          </TabsContent>
        )}
        {cliente.relacionDependencia && (
          <TabsContent value="relacion-dependencia" className="mt-0">
            <RelacionDependencia cliente={cliente} calc={calc} />
          </TabsContent>
        )}
        <TabsContent value="reconciliacion" className="mt-0">
          <ReconciliacionBancaria cliente={cliente} />
        </TabsContent>
        <TabsContent value="comprobantes" className="mt-0">
          <ListaComprobantes cliente={cliente} onCambio={() => void refetchCliente()} />
        </TabsContent>
        <TabsContent value="dfe" className="mt-0">
          <DomicilioElectronico cliente={cliente} />
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
