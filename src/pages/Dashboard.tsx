import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  Users,
  Search,
  Plus,
  ChevronRight,
  Calendar,
  TrendingUp,
  RefreshCcw,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SemaforoDot, AlertaBadge } from '@/components/shared/AlertaBadge';
import { ProgresoTope } from '@/components/shared/ProgresoTope';
import { CLIENTES } from '@/data/clientes';
import { useConfig } from '@/context/ConfigContext';
import { calcularCliente } from '@/lib/monotributo';
import { esMonotributista, etiquetaRegimenCorta } from '@/lib/regimen';
import { derivarAlertas, estadoDesdeAlertas } from '@/lib/alertas';
import { useClientesReales } from '@/lib/queries';
import { useCargas } from '@/context/CargasContext';
import { cuentaActual } from '@/lib/cuenta';
import { formatCuit, formatPercent, formatDate } from '@/lib/utils';
import type { EstadoAlerta, TipoActividad } from '@/types';

const orden: Record<EstadoAlerta, number> = { rojo: 0, gris: 1, amarillo: 2, verde: 3 };

// Fila ya calculada que alimenta la tabla/tarjetas.
type FilaCliente = {
  cliente: (typeof CLIENTES)[number];
  calc: ReturnType<typeof calcularCliente>;
  estado: EstadoAlerta;
};

// Columnas por las que se puede ordenar. Cada una expone un valor comparable
// (número o string); los nulos van siempre al final sin importar el sentido.
type ColumnaOrden = 'nombre' | 'categoria' | 'tope' | 'ratio' | 'ventana' | 'estado' | 'extraccion';

const accesoresOrden: Record<ColumnaOrden, (f: FilaCliente) => number | string | null> = {
  nombre: f => f.cliente.nombre.toLowerCase(),
  categoria: f => (esMonotributista(f.cliente) ? f.cliente.categoria ?? '' : null),
  tope: f => (esMonotributista(f.cliente) ? f.calc.porcentajeTopeActual : null),
  ratio: f => (esMonotributista(f.cliente) ? f.calc.ratioGastosTopeCatK : null),
  ventana: f =>
    esMonotributista(f.cliente) && Number.isFinite(f.calc.diasParaProximaVentana)
      ? f.calc.diasParaProximaVentana
      : null,
  estado: f => orden[f.estado],
  extraccion: f => (f.cliente.ultimaExtraccion ? Date.parse(f.cliente.ultimaExtraccion) : null),
};

type Sentido = 'asc' | 'desc';

export function Dashboard() {
  const [busqueda, setBusqueda] = useState('');
  const [filtroAlerta, setFiltroAlerta] = useState<EstadoAlerta | 'todos'>('todos');
  const [filtroActividad, setFiltroActividad] = useState<TipoActividad | 'todos'>('todos');
  // Orden por defecto: alfabético por nombre del cliente (A→Z).
  const [ordenarPor, setOrdenarPor] = useState<ColumnaOrden>('nombre');
  const [sentido, setSentido] = useState<Sentido>('asc');

  // Click en un encabezado: si ya es la columna activa, alterna asc/desc;
  // si es otra, la activa en ascendente.
  const ordenarColumna = (col: ColumnaOrden) => {
    if (ordenarPor === col) {
      setSentido(s => (s === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrdenarPor(col);
      setSentido('asc');
    }
  };
  const cuenta = cuentaActual();
  // Cartera cacheada (React Query). El InvalidadorCache global la re-trae al terminar una carga o
  // sincronización en segundo plano; el botón de refrescar usa refetch(). Sin backend → [] + mock.
  const { data: reales = [], isFetching: recargando, refetch } = useClientesReales();

  // La cartera de ejemplo (mock) sólo se ve en cuentas "de ejemplo"; una cuenta nueva arranca vacía.
  const mock = cuenta?.datosEjemplo ? CLIENTES : [];

  const { config } = useConfig();
  const clientesConCalculo = useMemo(
    () =>
      [...reales, ...mock].map(c0 => {
        const c = c0; // el backend ya devuelve el cliente con las ediciones del contador aplicadas
        const calc = calcularCliente(c, config.ventanas, config.inflacionMensualProyeccion);
        const alertas = derivarAlertas(c, calc, config);
        return { cliente: c, calc, alertas, estado: estadoDesdeAlertas(alertas, c) };
      }),
    [reales, cuenta?.datosEjemplo, config],
  );

  const filtrados = useMemo(() => {
    const acceso = accesoresOrden[ordenarPor];
    const factor = sentido === 'asc' ? 1 : -1;
    return clientesConCalculo
      .filter(({ cliente, estado }) => {
        if (filtroAlerta !== 'todos' && estado !== filtroAlerta) return false;
        if (filtroActividad !== 'todos' && cliente.tipoActividad !== filtroActividad) return false;
        if (busqueda) {
          const q = busqueda.toLowerCase();
          const digitos = busqueda.replace(/\D/g, '');
          // OJO: cuit.includes('') es true para todos → si la búsqueda no tiene dígitos (ej. un
          // nombre), NO comparamos contra el CUIT; si no, no filtraría nada al buscar por nombre.
          return (
            cliente.nombre.toLowerCase().includes(q) ||
            (digitos !== '' && cliente.cuit.includes(digitos))
          );
        }
        return true;
      })
      .sort((a, b) => {
        const va = acceso(a);
        const vb = acceso(b);
        // Los valores sin dato (no monotributo, sin extracción…) van siempre al final.
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === 'string' || typeof vb === 'string') {
          return factor * String(va).localeCompare(String(vb), 'es');
        }
        return factor * (va - vb);
      });
  }, [clientesConCalculo, busqueda, filtroAlerta, filtroActividad, ordenarPor, sentido]);

  // Clientes que se están cargando ahora mismo (alta = trayendo sus comprobantes). Cada uno se
  // muestra como una fila propia con borde animado + progreso, y se OCULTA su fila normal mientras
  // tanto (evita el duplicado: alta directa crea el cliente al toque, aún sin datos). Al terminar la
  // carga, el InvalidadorCache re-trae la cartera y la fila normal —ya con datos— aparece sola.
  const { activas } = useCargas();
  const cargando = useMemo(
    () =>
      activas.flatMap(c =>
        c.clientes.map(cl => ({
          key: `${c.jobId}:${cl.cuit}`,
          cuit: cl.cuit,
          nombre: cl.nombre,
          progreso: c.progreso,
          mensaje: c.mensaje,
          cancelando: !!c.cancelando,
        })),
      ),
    [activas],
  );
  const cuitsCargando = useMemo(
    () => new Set(cargando.map(e => e.cuit.replace(/\D/g, ''))),
    [cargando],
  );

  const propsOrden = { ordenarPor, sentido, onOrdenar: ordenarColumna };

  const resumen = useMemo(() => {
    const counts = { rojo: 0, amarillo: 0, gris: 0, verde: 0 };
    clientesConCalculo.forEach(({ estado }) => counts[estado]++);
    return counts;
  }, [clientesConCalculo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Mi cartera</h1>
          <p className="text-base text-muted-foreground mt-2">
            {clientesConCalculo.length} clientes bajo monitoreo automático.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/clientes/nuevo">
              <Plus className="h-4 w-4" /> Nuevo cliente
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <ResumenCard
          label="Acción urgente"
          value={resumen.rojo}
          icon={<AlertCircle className="h-4 w-4" />}
          tint="bg-danger/10 text-danger"
          onClick={() => setFiltroAlerta('rojo')}
          active={filtroAlerta === 'rojo'}
        />
        <ResumenCard
          label="Monitoreo activo"
          value={resumen.amarillo}
          icon={<AlertTriangle className="h-4 w-4" />}
          tint="bg-warning/20 text-warning-foreground"
          onClick={() => setFiltroAlerta('amarillo')}
          active={filtroAlerta === 'amarillo'}
        />
        <ResumenCard
          label="Sin datos"
          value={resumen.gris}
          icon={<HelpCircle className="h-4 w-4" />}
          tint="bg-muted text-muted-foreground"
          onClick={() => setFiltroAlerta('gris')}
          active={filtroAlerta === 'gris'}
        />
        <ResumenCard
          label="Total clientes"
          value={clientesConCalculo.length}
          icon={<Users className="h-4 w-4" />}
          tint="bg-primary/10 text-primary"
          onClick={() => setFiltroAlerta('todos')}
          active={filtroAlerta === 'todos'}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center gap-3 p-4 border-b border-border/60 bg-muted/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o CUIT"
              className="pl-9 bg-card"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={filtroAlerta}
              onValueChange={(v) => setFiltroAlerta(v as EstadoAlerta | 'todos')}
            >
              <SelectTrigger className="flex-1 md:w-[170px] md:flex-none bg-card">
                <SelectValue placeholder="Estado de alerta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                <SelectItem value="rojo">Acción urgente</SelectItem>
                <SelectItem value="amarillo">Monitoreo activo</SelectItem>
                <SelectItem value="gris">Sin datos</SelectItem>
                <SelectItem value="verde">Sin alertas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filtroActividad}
              onValueChange={(v) => setFiltroActividad(v as TipoActividad | 'todos')}
            >
              <SelectTrigger className="flex-1 md:w-[140px] md:flex-none bg-card">
                <SelectValue placeholder="Actividad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                <SelectItem value="comercio">Comercio</SelectItem>
                <SelectItem value="servicios">Servicios</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 bg-card"
              onClick={() => void refetch()}
              disabled={recargando}
              title="Refrescar la lista de clientes"
              aria-label="Refrescar la lista de clientes"
            >
              <RefreshCcw className={`h-4 w-4 ${recargando ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <HeadOrdenable col="nombre" label="Cliente" className="w-[280px]" {...propsOrden} />
              <HeadOrdenable col="categoria" label="Categoría" {...propsOrden} />
              <HeadOrdenable col="tope" label="% tope consumido" className="w-[220px]" {...propsOrden} />
              <HeadOrdenable col="ratio" label="Ratio gastos" {...propsOrden} />
              <HeadOrdenable col="ventana" label="Próx. ventana" {...propsOrden} />
              <HeadOrdenable col="estado" label="Estado" {...propsOrden} />
              <HeadOrdenable col="extraccion" label="Última extracción" {...propsOrden} />
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando.map(e => (
              <TableRow key={e.key} className="hover:bg-transparent">
                <TableCell colSpan={8} className="p-2">
                  <CajaCargando cuit={e.cuit} nombre={e.nombre} progreso={e.progreso} mensaje={e.mensaje} cancelando={e.cancelando} />
                </TableCell>
              </TableRow>
            ))}
            {filtrados.map(({ cliente, calc, estado }) => {
              if (cuitsCargando.has(cliente.cuit.replace(/\D/g, ''))) return null;
              const noMono = !esMonotributista(cliente);
              return (
              <TableRow key={cliente.id} className="group">
                <TableCell>
                  <Link
                    to={`/clientes/${cliente.id}`}
                    className="flex items-center gap-3 group-hover:text-primary transition-colors"
                  >
                    <SemaforoDot estado={estado} />
                    <div>
                      <div className="font-medium leading-tight">{cliente.nombre}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatCuit(cliente.cuit)}
                      </div>
                    </div>
                  </Link>
                </TableCell>
                <TableCell>
                  {noMono ? (
                    <Badge variant="muted" className="font-semibold">
                      {etiquetaRegimenCorta(cliente.regimen)}
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-semibold">
                        {cliente.categoria}
                      </Badge>
                      {calc.categoriaCorresponde.codigo !== cliente.categoria && (
                        <div className="flex items-center gap-0.5 text-xs text-warning-foreground">
                          <TrendingUp className="h-3 w-3" />
                          {calc.categoriaCorresponde.codigo}
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {noMono ? (
                    <span className="text-muted-foreground text-xs">No aplica</span>
                  ) : (
                    <ProgresoTope porcentaje={calc.porcentajeTopeActual} />
                  )}
                </TableCell>
                <TableCell>
                  {noMono ? (
                    <span className="text-muted-foreground text-xs">—</span>
                  ) : (
                    <div className="space-y-0.5">
                      <div
                        className={
                          calc.ratioSuperadoLegal
                            ? 'text-danger font-medium text-sm tabular-nums'
                            : 'text-sm tabular-nums'
                        }
                      >
                        {formatPercent(calc.ratioGastosTopeCatK, 1)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        sobre tope cat. K
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {!noMono && Number.isFinite(calc.diasParaProximaVentana) ? (
                    <div className="flex items-center gap-1.5 text-sm">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="tabular-nums">
                        {calc.diasParaProximaVentana}d
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <AlertaBadge estado={estado} />
                </TableCell>
                <TableCell>
                  {cliente.ultimaExtraccion ? (
                    <div className="text-xs">
                      <div
                        className={
                          cliente.resultadoUltimaExtraccion === 'fallida'
                            ? 'text-danger'
                            : 'text-muted-foreground'
                        }
                      >
                        {formatDate(cliente.ultimaExtraccion)}
                      </div>
                      {cliente.resultadoUltimaExtraccion === 'fallida' && (
                        <div className="text-danger/80 text-[11px] mt-0.5 max-w-[180px] truncate">
                          {cliente.motivoFalloUltimaExtraccion}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/clientes/${cliente.id}`}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
              );
            })}
            {filtrados.length === 0 && cargando.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No hay clientes que coincidan con los filtros aplicados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>

        <div className="space-y-3 p-4 lg:hidden">
          {cargando.map(e => (
            <CajaCargando key={e.key} cuit={e.cuit} nombre={e.nombre} progreso={e.progreso} mensaje={e.mensaje} cancelando={e.cancelando} />
          ))}
          {filtrados.map(({ cliente, calc, estado }) => {
            if (cuitsCargando.has(cliente.cuit.replace(/\D/g, ''))) return null;
            const noMono = !esMonotributista(cliente);
            const recategoriza = !noMono && calc.categoriaCorresponde.codigo !== cliente.categoria;
            return (
              <Link
                key={cliente.id}
                to={`/clientes/${cliente.id}`}
                className="block rounded-xl border border-border/60 p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <SemaforoDot estado={estado} />
                    <div className="min-w-0">
                      <div className="font-medium leading-tight truncate">{cliente.nombre}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatCuit(cliente.cuit)}
                      </div>
                    </div>
                  </div>
                  <AlertaBadge estado={estado} />
                </div>

                {noMono ? (
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="muted" className="font-semibold">
                      {etiquetaRegimenCorta(cliente.regimen)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Sin seguimiento de monotributo</span>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-semibold">
                          {cliente.categoria}
                        </Badge>
                        {recategoriza && (
                          <span className="flex items-center gap-0.5 text-xs text-warning-foreground">
                            <TrendingUp className="h-3 w-3" />
                            {calc.categoriaCorresponde.codigo}
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          calc.ratioSuperadoLegal
                            ? 'text-danger font-medium tabular-nums'
                            : 'text-muted-foreground tabular-nums'
                        }
                      >
                        {formatPercent(calc.ratioGastosTopeCatK, 1)} s/ tope K
                      </span>
                    </div>
                    <ProgresoTope porcentaje={calc.porcentajeTopeActual} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {Number.isFinite(calc.diasParaProximaVentana)
                          ? `Próx. ventana ${calc.diasParaProximaVentana}d`
                          : 'Sin ventana'}
                      </span>
                      {cliente.ultimaExtraccion && (
                        <span
                          className={
                            cliente.resultadoUltimaExtraccion === 'fallida'
                              ? 'text-danger'
                              : ''
                          }
                        >
                          {formatDate(cliente.ultimaExtraccion)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
          {filtrados.length === 0 && cargando.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              No hay clientes que coincidan con los filtros aplicados.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

interface CajaCargandoProps {
  cuit: string;
  nombre: string;
  progreso: number;
  mensaje: string;
  cancelando?: boolean;
}

// Recuadro de un cliente que se está cargando: borde azul que recorre el perímetro (clase
// `borde-cargando`, definida en index.css) + barra de progreso y el mensaje del momento. Sirve
// tanto para la fila de la tabla (envuelto en una celda) como para la tarjeta mobile.
function CajaCargando({ cuit, nombre, progreso, mensaje, cancelando }: CajaCargandoProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progreso)));
  return (
    <div className="relative rounded-xl border border-border/50 bg-card">
      <span className="borde-cargando" aria-hidden="true" />
      <div className="relative flex items-center gap-3 px-3 py-2.5">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium leading-tight">
                {nombre || `CUIT ${formatCuit(cuit)}`}
              </div>
              {nombre && (
                <div className="text-xs tabular-nums text-muted-foreground">{formatCuit(cuit)}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {cancelando ? (
                <span className="text-xs font-medium text-muted-foreground">Cancelando…</span>
              ) : (
                <>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{mensaje}</span>
                  <span className="text-sm font-semibold tabular-nums text-primary">{pct}%</span>
                </>
              )}
            </div>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-primary/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface HeadOrdenableProps {
  col: ColumnaOrden;
  label: string;
  className?: string;
  ordenarPor: ColumnaOrden;
  sentido: Sentido;
  onOrdenar: (col: ColumnaOrden) => void;
}

function HeadOrdenable({ col, label, className, ordenarPor, sentido, onOrdenar }: HeadOrdenableProps) {
  const activa = ordenarPor === col;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onOrdenar(col)}
        className={`-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground ${
          activa ? 'text-foreground' : ''
        }`}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {activa ? (
          sentido === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

interface ResumenCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  tint: string;
  onClick?: () => void;
  active?: boolean;
}

function ResumenCard({ label, value, icon, tint, onClick, active }: ResumenCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-card border ${
        active ? 'border-primary/40 shadow-card-lg' : 'border-border/60 shadow-card'
      } rounded-xl p-4 transition-all hover:border-primary/40 hover:shadow-card-lg`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tint}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    </button>
  );
}
