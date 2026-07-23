import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Percent, Loader2, FileText, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useClientesReales } from '@/lib/queries';
import {
  getPeriodosIva,
  getLibroIva,
  type DireccionIva,
  type IvaLibro,
  type IvaSubtotales,
} from '@/services/ivaService';
import { formatCurrency, formatCuit, cn } from '@/lib/utils';

/**
 * Apartado de IVA (piloto). Muestra el Libro IVA de Ventas/Compras de un cliente por período, armado
 * con los comprobantes que la app ya tiene. El desglose de IVA discriminado (neto/IVA de un
 * Responsable Inscripto) se irá completando; en Monotributo no hay IVA discriminado (neto = total).
 *
 * Rollout gateado: sólo llegan acá las cuentas habilitadas (RequireIVA); el backend valida el mismo
 * gate en cada endpoint.
 */
export function IVA() {
  const { data: cartera = [], isLoading: cargandoCartera } = useClientesReales();
  const [cuit, setCuit] = useState<string>('');
  const [direccion, setDireccion] = useState<DireccionIva>('ventas');
  const [periodo, setPeriodo] = useState<string>('');

  // Cliente elegido (default: el primero de la cartera en cuanto carga).
  const cuitActivo = cuit || cartera[0]?.cuit || '';
  const clienteActivo = cartera.find(c => c.cuit === cuitActivo);

  const { data: periodos = [], isLoading: cargandoPeriodos } = useQuery({
    queryKey: ['iva', 'periodos', cuitActivo],
    queryFn: () => getPeriodosIva(cuitActivo),
    enabled: !!cuitActivo,
  });

  // Período elegido (default: el más reciente disponible).
  const periodoActivo = periodo || periodos[0]?.periodo || '';

  const { data: libro, isLoading: cargandoLibro } = useQuery({
    queryKey: ['iva', 'libro', cuitActivo, periodoActivo, direccion],
    queryFn: () => getLibroIva(cuitActivo, periodoActivo, direccion),
    enabled: !!cuitActivo && !!periodoActivo,
  });

  const sub = libro?.subtotales;
  // ¿La columna IVA aporta algo en este libro? (en Monotributo es siempre 0). Si no, se atenúa.
  const hayIva = useMemo(
    () => (libro?.lineas ?? []).some(l => l.iva !== 0),
    [libro]
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">IVA</h1>
          <Badge variant="outline" className="text-warning-foreground border-warning/50 bg-warning/10">
            Piloto
          </Badge>
        </div>
        <p className="text-base text-muted-foreground mt-2">
          Libro IVA de Ventas y Compras de tus clientes, armado con sus comprobantes.
        </p>
      </div>

      {/* Selectores: cliente + período */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cliente</label>
            <Select
              value={cuitActivo}
              onValueChange={v => {
                setCuit(v);
                setPeriodo(''); // el nuevo cliente tiene otros períodos: volvé al más reciente
              }}
              disabled={cargandoCartera || cartera.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue placeholder={cargandoCartera ? 'Cargando…' : 'Elegí un cliente'} />
              </SelectTrigger>
              <SelectContent>
                {cartera.map(c => (
                  <SelectItem key={c.cuit} value={c.cuit}>
                    {c.nombre} · {formatCuit(c.cuit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Período</label>
            <Select
              value={periodoActivo}
              onValueChange={setPeriodo}
              disabled={cargandoPeriodos || periodos.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue
                  placeholder={
                    cargandoPeriodos ? 'Cargando…' : periodos.length ? 'Elegí un período' : 'Sin períodos'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {periodos.map(p => (
                  <SelectItem key={p.periodo} value={p.periodo}>
                    {p.label}
                    <span className="text-muted-foreground">
                      {'  ·  '}
                      {direccion === 'ventas' ? `${p.ventas} vta.` : `${p.compras} cpr.`}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4">
          <Tabs value={direccion} onValueChange={v => setDireccion(v as DireccionIva)}>
            <TabsList>
              <TabsTrigger value="ventas">Ventas</TabsTrigger>
              <TabsTrigger value="compras">Compras</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </Card>

      {/* Contenido */}
      {!cargandoCartera && cartera.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no tenés clientes"
          detalle="Cuando agregues clientes, vas a poder ver acá su Libro IVA."
        />
      ) : cargandoLibro || cargandoPeriodos ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !periodoActivo || !libro || libro.lineas.length === 0 ? (
        <EstadoVacio
          titulo="Sin comprobantes en este período"
          detalle={
            clienteActivo
              ? `${clienteActivo.nombre} no tiene ${direccion === 'ventas' ? 'ventas' : 'compras'} registradas en el período elegido.`
              : 'Elegí un cliente y un período para ver su Libro IVA.'
          }
        />
      ) : (
        <LibroTabla libro={libro} sub={sub!} hayIva={hayIva} direccion={direccion} />
      )}
    </div>
  );
}

function EstadoVacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Percent className="h-6 w-6" />
      </div>
      <div className="font-medium">{titulo}</div>
      <div className="max-w-md text-sm text-muted-foreground">{detalle}</div>
    </Card>
  );
}

function LibroTabla({
  libro,
  sub,
  hayIva,
  direccion,
}: {
  libro: IvaLibro;
  sub: IvaSubtotales;
  hayIva: boolean;
  direccion: DireccionIva;
}) {
  const contraparte = direccion === 'ventas' ? 'Cliente' : 'Proveedor';
  return (
    <Card className="overflow-hidden">
      {/* Escritorio: tabla */}
      <div className="hidden lg:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Comprobante</TableHead>
              <TableHead>{contraparte}</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className={cn('text-right', !hayIva && 'text-muted-foreground/60')}>IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {libro.lineas.map(l => (
              <TableRow key={l.id} className={cn(l.esNotaCredito && 'text-danger')}>
                <TableCell className="whitespace-nowrap tabular-nums">{fechaCorta(l.fecha)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{l.tipo}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {String(l.puntoVenta).padStart(5, '0')}-{l.numero}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[22rem] truncate">{l.contraparteNombre}</div>
                  {l.contraparteCuit && (
                    <div className="text-xs text-muted-foreground tabular-nums">{l.contraparteCuit}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{signo(l.esNotaCredito, l.neto)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', !hayIva && 'text-muted-foreground/60')}>
                  {signo(l.esNotaCredito, l.iva)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {signo(l.esNotaCredito, l.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                {sub.cantidad} comprobante{sub.cantidad === 1 ? '' : 's'}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.neto)}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.iva)}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Mobile: tarjetas (convención del proyecto tabla→tarjetas) */}
      <div className="lg:hidden divide-y">
        {libro.lineas.map(l => (
          <div key={l.id} className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={cn(l.esNotaCredito && 'text-danger')}>{l.tipo}</span>
                <span className="tabular-nums text-muted-foreground">
                  {String(l.puntoVenta).padStart(5, '0')}-{l.numero}
                </span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{fechaCorta(l.fecha)}</span>
            </div>
            <div className="truncate text-sm text-muted-foreground">{l.contraparteNombre}</div>
            <div className="flex justify-between text-sm tabular-nums">
              <span className="text-muted-foreground">Neto {signo(l.esNotaCredito, l.neto)}</span>
              <span className="text-muted-foreground">IVA {signo(l.esNotaCredito, l.iva)}</span>
              <span className={cn('font-medium', l.esNotaCredito && 'text-danger')}>
                {signo(l.esNotaCredito, l.total)}
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between p-4 font-semibold">
          <span>Total ({sub.cantidad})</span>
          <span className="tabular-nums">{formatCurrency(sub.total)}</span>
        </div>
      </div>

      {!hayIva && direccion === 'ventas' && (
        <div className="flex items-start gap-2 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este cliente no discrimina IVA en sus comprobantes (régimen de Monotributo): el neto
            coincide con el total.
          </span>
        </div>
      )}
    </Card>
  );
}

function signo(esNc: boolean, valor: number): string {
  const v = esNc ? -Math.abs(valor) : valor;
  return formatCurrency(v);
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}
