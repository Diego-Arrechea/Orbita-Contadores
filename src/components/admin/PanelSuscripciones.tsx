/**
 * Tab "Suscripciones" del panel superadmin: el estado comercial de cada cuenta de contador.
 *
 * Desde acá se ve quién está al día, quién está por vencer y cuánto factura la cartera, se le
 * cambia el plan/precio/vencimiento a una cuenta y se registran los cobros (la cobranza es manual:
 * cada pago corre el vencimiento un ciclo). Vencer NO corta el servicio todavía: sólo cambia el
 * estado que se ve acá y en "Mi suscripción" del contador.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarClock,
  CreditCard,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Textarea } from '@/components/ui/textarea';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { mensajeDeError } from '@/services/authService';
import {
  ESTADO_SUSCRIPCION_META,
  borrarPago,
  editarSuscripcion,
  listarPlanes,
  listarSuscripciones,
  obtenerSuscripcion,
  registrarPago,
  type AdminSuscripcion,
  type CicloSuscripcion,
  type EstadoSuscripcion,
  type MedioPago,
} from '@/services/suscripcionService';

const QK = ['admin', 'suscripciones'] as const;

const ESTADOS: EstadoSuscripcion[] = ['activa', 'prueba', 'vencida', 'cancelada', 'sin_cargo'];
const MEDIOS: { valor: MedioPago; label: string }[] = [
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'efectivo', label: 'Efectivo' },
  { valor: 'mercadopago', label: 'Mercado Pago' },
  { valor: 'tarjeta', label: 'Tarjeta' },
  { valor: 'otro', label: 'Otro' },
];

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** Vencimiento con su semáforo: rojo si pasó, ámbar si está a menos de 10 días. */
function Vencimiento({ s }: { s: AdminSuscripcion }) {
  if (!s.vence) return <span className="text-muted-foreground">—</span>;
  const dias = s.dias_restantes ?? null;
  const tono =
    dias === null ? '' : dias < 0 ? 'text-danger' : dias <= 10 ? 'text-warning-foreground' : '';
  return (
    <span className={cn('tabular-nums', tono)}>
      {formatDate(s.vence)}
      {dias !== null && (
        <span className="ml-1 text-xs text-muted-foreground">
          ({dias < 0 ? `hace ${-dias}d` : `en ${dias}d`})
        </span>
      )}
    </span>
  );
}

function Metrica({
  icono: Icono,
  titulo,
  valor,
  detalle,
  tono,
}: {
  icono: typeof Users;
  titulo: string;
  valor: string;
  detalle?: string;
  tono?: 'danger' | 'warning' | 'success';
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icono className="h-4 w-4" /> {titulo}
      </div>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tracking-tight tabular-nums',
          tono === 'danger' && 'text-danger',
          tono === 'warning' && 'text-warning-foreground',
          tono === 'success' && 'text-success'
        )}
      >
        {valor}
      </p>
      {detalle && <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>}
    </Card>
  );
}

// --- Editar la suscripción de una cuenta ---

function DialogEditar({
  sus,
  open,
  onOpenChange,
}: {
  sus: AdminSuscripcion;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: planes = [] } = useQuery({ queryKey: ['planes'], queryFn: listarPlanes });
  const [plan, setPlan] = useState(sus.plan);
  const [estado, setEstado] = useState<EstadoSuscripcion>(sus.estado_guardado);
  const [ciclo, setCiclo] = useState<CicloSuscripcion>(sus.ciclo);
  // Vacío = usa el precio de lista del plan.
  const [precio, setPrecio] = useState(sus.precio_personalizado ? String(sus.precio) : '');
  const [limite, setLimite] = useState(
    sus.limite_clientes !== null && sus.limite_clientes !== undefined ? String(sus.limite_clientes) : ''
  );
  const [inicio, setInicio] = useState(sus.inicio ?? '');
  const [vence, setVence] = useState(sus.vence ?? '');
  const [notas, setNotas] = useState(sus.notas ?? '');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      editarSuscripcion(sus.usuario_id, {
        plan,
        estado,
        ciclo,
        precio: precio.trim() === '' ? null : Number(precio),
        limite_clientes: limite.trim() === '' ? null : Number(limite),
        inicio: inicio || null,
        vence: vence || null,
        notas: notas.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK });
      onOpenChange(false);
    },
    onError: (e: unknown) => setError(mensajeDeError(e)),
  });

  const planElegido = planes.find(p => p.clave === plan);

  return (
    <Dialog open={open} onOpenChange={o => !guardar.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" /> Suscripción de {sus.nombre}{' '}
            {sus.apellido}
          </DialogTitle>
          <DialogDescription>
            {sus.estudio} · {sus.email}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-danger/25 bg-danger/12 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {planes.map(p => (
                  <SelectItem key={p.clave} value={p.clave}>
                    {p.nombre} · {p.precio > 0 ? formatCurrency(p.precio) + '/mes' : 'sin cargo'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select value={estado} onValueChange={v => setEstado(v as EstadoSuscripcion)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS.map(e => (
                  <SelectItem key={e} value={e}>
                    {ESTADO_SUSCRIPCION_META[e].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Facturación</Label>
            <Select value={ciclo} onValueChange={v => setCiclo(v as CicloSuscripcion)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mensual">Mensual</SelectItem>
                <SelectItem value="anual">Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="precio">Precio acordado</Label>
            <Input
              id="precio"
              inputMode="numeric"
              placeholder={
                planElegido
                  ? `De lista: ${planElegido.precio * (ciclo === 'anual' ? 12 : 1)}`
                  : 'De lista'
              }
              value={precio}
              onChange={e => setPrecio(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Vacío = precio de lista del plan.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="limite">Tope de clientes</Label>
            <Input
              id="limite"
              inputMode="numeric"
              placeholder={planElegido?.limite_clientes ? String(planElegido.limite_clientes) : 'Sin tope'}
              value={limite}
              onChange={e => setLimite(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Vacío = el del plan. Hoy es informativo.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inicio">Cliente desde</Label>
            <Input
              id="inicio"
              type="date"
              value={inicio}
              onChange={e => setInicio(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vence">Pago hasta</Label>
            <Input id="vence" type="date" value={vence} onChange={e => setVence(e.target.value)} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notas">Notas internas</Label>
            <Textarea
              id="notas"
              rows={2}
              placeholder="Acuerdo, a quién se le factura, descuentos…"
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">No las ve el contador.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Cobranza: registrar pagos y ver el historial ---

function DialogPagos({
  sus,
  open,
  onOpenChange,
}: {
  sus: AdminSuscripcion;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: [...QK, sus.usuario_id],
    queryFn: () => obtenerSuscripcion(sus.usuario_id),
    enabled: open,
  });

  const [fecha, setFecha] = useState(hoyISO());
  const [importe, setImporte] = useState(String(sus.precio || ''));
  const [medio, setMedio] = useState<MedioPago>('transferencia');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState<string | null>(null);

  function refrescar() {
    void qc.invalidateQueries({ queryKey: QK });
  }

  const alta = useMutation({
    mutationFn: () =>
      registrarPago(sus.usuario_id, {
        fecha,
        importe: Number(importe),
        medio,
        periodo_desde: desde || null,
        periodo_hasta: hasta || null,
        referencia: referencia.trim() || null,
      }),
    onSuccess: () => {
      setReferencia('');
      setDesde('');
      setHasta('');
      setError(null);
      refrescar();
    },
    onError: (e: unknown) => setError(mensajeDeError(e)),
  });

  const baja = useMutation({
    mutationFn: (pagoId: number) => borrarPago(sus.usuario_id, pagoId),
    onSuccess: refrescar,
    onError: (e: unknown) => setError(mensajeDeError(e)),
  });

  const pagos = data?.pagos ?? [];
  const vence = data?.suscripcion.vence ?? sus.vence;

  return (
    <Dialog open={open} onOpenChange={o => !alta.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" /> Pagos de {sus.nombre} {sus.apellido}
          </DialogTitle>
          <DialogDescription>
            {sus.estudio} · {sus.plan_nombre} ·{' '}
            {vence ? `paga hasta el ${formatDate(vence)}` : 'sin vencimiento'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-danger/25 bg-danger/12 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pago-fecha">Fecha del cobro</Label>
            <Input
              id="pago-fecha"
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pago-importe">Importe</Label>
            <Input
              id="pago-importe"
              inputMode="numeric"
              value={importe}
              onChange={e => setImporte(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Medio</Label>
            <Select value={medio} onValueChange={v => setMedio(v as MedioPago)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIOS.map(m => (
                  <SelectItem key={m.valor} value={m.valor}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pago-desde">Período desde</Label>
            <Input
              id="pago-desde"
              type="date"
              value={desde}
              onChange={e => setDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pago-hasta">Período hasta</Label>
            <Input
              id="pago-hasta"
              type="date"
              value={hasta}
              onChange={e => setHasta(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pago-ref">Referencia</Label>
            <Input
              id="pago-ref"
              placeholder="Nº de operación"
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Si dejás el período vacío, se toma un ciclo desde donde terminaba lo ya pago. El pago
            corre el vencimiento y deja la cuenta al día.
          </p>
          <Button
            className="sm:justify-self-end"
            onClick={() => alta.mutate()}
            disabled={alta.isPending || !Number(importe)}
          >
            {alta.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Registrar pago
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando pagos…</p>
          ) : pagos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pagos.map(p => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium tabular-nums">
                      {formatDate(p.fecha)} · {formatCurrency(p.importe)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {MEDIOS.find(m => m.valor === p.medio)?.label ?? p.medio}
                      {p.periodo_desde && p.periodo_hasta
                        ? ` · ${formatDate(p.periodo_desde)} → ${formatDate(p.periodo_hasta)}`
                        : ''}
                      {p.referencia ? ` · ${p.referencia}` : ''}
                      {p.registrado_por ? ` · cargado por ${p.registrado_por}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => baja.mutate(p.id)}
                    disabled={baja.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Tab ---

export function PanelSuscripciones() {
  const { data, isLoading, error } = useQuery({ queryKey: QK, queryFn: listarSuscripciones });
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'todas' | EstadoSuscripcion>('todas');
  const [editando, setEditando] = useState<AdminSuscripcion | null>(null);
  const [cobrando, setCobrando] = useState<AdminSuscripcion | null>(null);

  const items = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return (data?.items ?? []).filter(s => {
      if (filtro !== 'todas' && s.estado !== filtro) return false;
      if (!texto) return true;
      return `${s.nombre} ${s.apellido} ${s.email} ${s.estudio}`.toLowerCase().includes(texto);
    });
  }, [data, busqueda, filtro]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando suscripciones…
      </div>
    );
  }
  if (error || !data) {
    return <p className="py-6 text-sm text-danger">No se pudieron cargar las suscripciones.</p>;
  }

  const r = data.resumen;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metrica
          icono={TrendingUp}
          titulo="Ingreso mensual"
          valor={formatCurrency(r.ingreso_mensual)}
          detalle={`${r.activas} al día · ${r.en_prueba} en prueba`}
          tono="success"
        />
        <Metrica
          icono={BadgeDollarSign}
          titulo="Cobrado (30 días)"
          valor={formatCurrency(r.cobrado_30d)}
          detalle="Pagos registrados"
        />
        <Metrica
          icono={CalendarClock}
          titulo="Por vencer"
          valor={String(r.por_vencer_30d)}
          detalle="Vencen dentro de 30 días"
          tono={r.por_vencer_30d > 0 ? 'warning' : undefined}
        />
        <Metrica
          icono={AlertTriangle}
          titulo="Vencidas"
          valor={String(r.vencidas)}
          detalle={`${r.cuentas} cuentas · ${r.sin_cargo} sin cargo`}
          tono={r.vencidas > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por contador, estudio o correo…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={v => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos los estados</SelectItem>
            {ESTADOS.map(e => (
              <SelectItem key={e} value={e}>
                {ESTADO_SUSCRIPCION_META[e].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        {items.length} cuenta(s). El vencimiento no corta el acceso: sólo marca el estado.
      </p>

      {/* Escritorio: tabla */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contador</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead>Paga hasta</TableHead>
              <TableHead className="text-right">Clientes</TableHead>
              <TableHead>Último pago</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(s => (
              <TableRow key={s.usuario_id} className={cn(!s.activo && 'opacity-60')}>
                <TableCell>
                  <p className="font-medium">
                    {s.nombre} {s.apellido}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.estudio} · {s.email}
                  </p>
                </TableCell>
                <TableCell>
                  {s.plan_nombre}
                  <span className="block text-xs text-muted-foreground">
                    {s.ciclo === 'anual' ? 'Anual' : 'Mensual'}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={ESTADO_SUSCRIPCION_META[s.estado].tono}>
                    {ESTADO_SUSCRIPCION_META[s.estado].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.precio > 0 ? formatCurrency(s.precio) : '—'}
                  {s.precio_personalizado && (
                    <span className="block text-xs text-muted-foreground">acordado</span>
                  )}
                </TableCell>
                <TableCell>
                  <Vencimiento s={s} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.clientes}
                  {s.limite_clientes ? (
                    <span className="text-muted-foreground">/{s.limite_clientes}</span>
                  ) : null}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {s.ultimo_pago ? formatDate(s.ultimo_pago) : '—'}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditando(s)}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar suscripción
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setCobrando(s)}>
                        <Wallet className="mr-2 h-4 w-4" /> Pagos
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile: tarjetas */}
      <ul className="space-y-2.5 lg:hidden">
        {items.map(s => (
          <li key={s.usuario_id}>
            <Card className={cn('p-4', !s.activo && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.nombre} {s.apellido}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{s.estudio}</p>
                </div>
                <Badge variant={ESTADO_SUSCRIPCION_META[s.estado].tono}>
                  {ESTADO_SUSCRIPCION_META[s.estado].label}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p>{s.plan_nombre}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Precio</p>
                  <p className="tabular-nums">
                    {s.precio > 0 ? formatCurrency(s.precio) : 'Sin cargo'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paga hasta</p>
                  <Vencimiento s={s} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Clientes</p>
                  <p className="tabular-nums">
                    {s.clientes}
                    {s.limite_clientes ? `/${s.limite_clientes}` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditando(s)}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCobrando(s)}>
                  <Wallet className="mr-1.5 h-4 w-4" /> Pagos
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {editando && (
        <DialogEditar
          key={`edit-${editando.usuario_id}`}
          sus={editando}
          open
          onOpenChange={o => !o && setEditando(null)}
        />
      )}
      {cobrando && (
        <DialogPagos
          key={`pagos-${cobrando.usuario_id}`}
          sus={cobrando}
          open
          onOpenChange={o => !o && setCobrando(null)}
        />
      )}
    </div>
  );
}
