import { useMemo, useState, useEffect } from 'react';
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
import { getClientesReales } from '@/services/clientesService';
import { cuentaActual } from '@/lib/cuenta';
import { useCargas } from '@/context/CargasContext';
import { useSync } from '@/context/SyncContext';
import { formatCuit, formatPercent, formatDate } from '@/lib/utils';
import type { EstadoAlerta, TipoActividad, Cliente } from '@/types';

const orden: Record<EstadoAlerta, number> = { rojo: 0, gris: 1, amarillo: 2, verde: 3 };

export function Dashboard() {
  const [busqueda, setBusqueda] = useState('');
  const [filtroAlerta, setFiltroAlerta] = useState<EstadoAlerta | 'todos'>('todos');
  const [filtroActividad, setFiltroActividad] = useState<TipoActividad | 'todos'>('todos');
  const [reales, setReales] = useState<Cliente[]>([]);
  const [recargando, setRecargando] = useState(false);
  const [reload, setReload] = useState(0); // se incrementa para forzar un refresco manual
  const cuenta = cuentaActual();
  const { version } = useCargas();
  const { version: syncVersion } = useSync();

  useEffect(() => {
    setRecargando(true);
    getClientesReales()
      .then(setReales) // el backend ya devuelve sólo los clientes de este contador
      .catch(() => {}) // si el backend no está, se muestran sólo los mock
      .finally(() => setRecargando(false));
    // `version`/`syncVersion` cambian al terminar una carga/sincronización en segundo plano, y
    // `reload` al apretar el botón de refrescar → re-trae la cartera sin recargar la página.
  }, [version, syncVersion, reload]);

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
    return clientesConCalculo
      .filter(({ cliente, estado }) => {
        if (filtroAlerta !== 'todos' && estado !== filtroAlerta) return false;
        if (filtroActividad !== 'todos' && cliente.tipoActividad !== filtroActividad) return false;
        if (busqueda) {
          const q = busqueda.toLowerCase();
          return (
            cliente.nombre.toLowerCase().includes(q) ||
            cliente.cuit.includes(busqueda.replace(/\D/g, ''))
          );
        }
        return true;
      })
      .sort((a, b) => orden[a.estado] - orden[b.estado]);
  }, [clientesConCalculo, busqueda, filtroAlerta, filtroActividad]);

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
              <SelectTrigger className="w-[170px] bg-card">
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
              <SelectTrigger className="w-[140px] bg-card">
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
              onClick={() => setReload(r => r + 1)}
              disabled={recargando}
              title="Refrescar la lista de clientes"
              aria-label="Refrescar la lista de clientes"
            >
              <RefreshCcw className={`h-4 w-4 ${recargando ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[280px]">Cliente</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="w-[220px]">% tope consumido</TableHead>
              <TableHead>Ratio gastos</TableHead>
              <TableHead>Próx. ventana</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Última extracción</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map(({ cliente, calc, estado }) => {
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
            {filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No hay clientes que coincidan con los filtros aplicados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
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
