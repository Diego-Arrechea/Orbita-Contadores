import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  ShieldOff,
  Users,
  Activity,
  Loader2,
  Search,
  LogIn,
  Power,
  AlertCircle,
  Building2,
  UserCheck,
  UserX,
  RefreshCcw,
  AlertTriangle,
  RotateCw,
  CheckCircle2,
  ArrowLeft,
  Receipt,
  ChevronRight,
  ChevronDown,
  Cpu,
  Clock,
  Timer,
  Zap,
  ChevronLeft,
  KeyRound,
  Copy,
  MoreVertical,
  MailCheck,
  MailWarning,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MessageCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  listarUsuarios,
  obtenerMetricas,
  editarUsuario,
  impersonar,
  listarAuditoria,
  listarSincronizacionesFallidas,
  listarAvisosNombre,
  reintentarSync,
  estadoSync,
  listarTodosLosClientes,
  obtenerFichaContador,
  obtenerEstadoMotor,
  restablecerPasswordUsuario,
  type AdminUsuario,
  type AdminMetricas,
  type AdminAuditoria,
  type AdminSyncFallida,
  type AdminAvisoNombre,
  type AdminCliente,
  type AdminContadorFicha,
  type MotorEstado,
  type MotorCliente,
} from '@/services/adminService';
import { mensajeDeError } from '@/services/authService';
import { iniciarImpersonacion, usuarioActual } from '@/lib/cuenta';
import { cn } from '@/lib/utils';

function fechaCorta(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fechaHora(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Botón "Actualizar" con feedback: fuerza un refetch (ignora el caché) y muestra "Actualizado ✓"
 *  un momento al terminar, para que se note que hizo algo aunque los datos no hayan cambiado. */
function BotonActualizar({
  refetch,
  isFetching,
}: {
  refetch: () => Promise<unknown>;
  isFetching: boolean;
}) {
  const [ok, setOk] = useState(false);
  async function go() {
    await refetch();
    setOk(true);
    window.setTimeout(() => setOk(false), 1500);
  }
  return (
    <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void go()}>
      {ok && !isFetching ? (
        <>
          <CheckCircle2 className="h-4 w-4 text-success" /> Actualizado
        </>
      ) : (
        <>
          <RefreshCcw className={cn('h-4 w-4', isFetching && 'animate-spin')} /> Actualizar
        </>
      )}
    </Button>
  );
}

export function Admin() {
  const navigate = useNavigate();
  const yo = usuarioActual();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Panel superadmin</h1>
          <p className="text-sm text-muted-foreground">Administración de cuentas del sistema.</p>
        </div>
      </div>

      <Tabs defaultValue="cuentas">
        <TabsList className="flex w-full max-w-full justify-start overflow-x-auto scrollbar-thin">
          <TabsTrigger value="cuentas" className="shrink-0">
            <Users className="h-4 w-4" /> Cuentas
          </TabsTrigger>
          <TabsTrigger value="clientes" className="shrink-0">
            <Building2 className="h-4 w-4" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="motor" className="shrink-0">
            <Cpu className="h-4 w-4" /> Motor
          </TabsTrigger>
          <TabsTrigger value="metricas" className="shrink-0">
            <Activity className="h-4 w-4" /> Métricas
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="shrink-0">
            <ShieldCheck className="h-4 w-4" /> Auditoría
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cuentas">
          <TabCuentas miId={yo?.id} onImpersonar={() => navigate('/')} />
        </TabsContent>
        <TabsContent value="clientes">
          <TabClientes />
        </TabsContent>
        <TabsContent value="motor">
          <TabMotor />
        </TabsContent>
        <TabsContent value="metricas">
          <TabMetricas />
        </TabsContent>
        <TabsContent value="auditoria">
          <TabAuditoria />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --- Restablecer contraseña (soporte): genera una clave temporal y la muestra una vez ---

function RestablecerPasswordDialog({
  usuario,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  usuario: AdminUsuario;
  trigger?: ReactNode;
  // Modo controlado (desde el menú de acciones): si se pasan, el padre maneja la apertura. Si no,
  // el diálogo se autocontrola con su propio trigger.
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [openInterno, setOpenInterno] = useState(false);
  const open = openProp ?? openInterno;
  const setOpen = onOpenChange ?? setOpenInterno;
  const [generando, setGenerando] = useState(false);
  const [temporal, setTemporal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Resetea el estado al abrir/cerrar para que cada apertura arranque en la pantalla de confirmación.
  function cambiarOpen(o: boolean) {
    if (generando) return;
    setOpen(o);
    if (!o) {
      setTemporal(null);
      setError(null);
      setCopiado(false);
    }
  }

  async function generar() {
    setGenerando(true);
    setError(null);
    try {
      const { password_temporal } = await restablecerPasswordUsuario(usuario.id);
      setTemporal(password_temporal);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGenerando(false);
    }
  }

  async function copiar() {
    if (!temporal) return;
    try {
      await navigator.clipboard.writeText(temporal);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sin portapapeles: el contador puede seleccionar el texto a mano */
    }
  }

  return (
    <Dialog open={open} onOpenChange={cambiarOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Restablecer contraseña
          </DialogTitle>
          <DialogDescription>
            {temporal
              ? `Pasale esta contraseña temporal a ${usuario.nombre} ${usuario.apellido}. La ve una sola vez: cuando cierres esta ventana no se puede volver a mostrar. Conviene que la cambie al ingresar (Configuración → Seguridad).`
              : `Se genera una contraseña temporal para ${usuario.nombre} ${usuario.apellido} (${usuario.email}) y se reemplaza la actual. Usalo cuando no puede ingresar.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-danger/12 border border-danger/25 px-3.5 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {temporal && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
            <code className="flex-1 font-mono text-sm break-all">{temporal}</code>
            <Button variant="outline" size="sm" onClick={() => void copiar()}>
              {copiado ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copiar
                </>
              )}
            </Button>
          </div>
        )}

        <DialogFooter>
          {temporal ? (
            <DialogClose asChild>
              <Button>Listo</Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="ghost" disabled={generando}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button onClick={() => void generar()} disabled={generando}>
                {generando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Generando…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" /> Generar contraseña temporal
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Estado de confirmación del correo del contador (columna del panel).
function EmailConfirmadoBadge({ confirmado }: { confirmado?: boolean }) {
  return confirmado ? (
    <Badge variant="success">
      <MailCheck className="h-3 w-3" /> Confirmado
    </Badge>
  ) : (
    <Badge variant="warning">
      <MailWarning className="h-3 w-3" /> Pendiente
    </Badge>
  );
}

// Menú de acciones (3 puntos) de cada cuenta: reemplaza los botones sueltos. El diálogo de
// restablecer contraseña va FUERA del menú (controlado por estado): abrir un modal desde un ítem del
// dropdown y dejarlo dentro del portal del menú trae problemas de foco.
function AccionesCuenta({
  u,
  miId,
  trabajando,
  onEntrarComo,
  onToggleActivo,
  onToggleRol,
}: {
  u: AdminUsuario;
  miId?: number;
  trabajando: boolean;
  onEntrarComo: (u: AdminUsuario) => void;
  onToggleActivo: (u: AdminUsuario) => void;
  onToggleRol: (u: AdminUsuario) => void;
}) {
  const [pwdOpen, setPwdOpen] = useState(false);
  const esYo = u.id === miId;
  const esAdmin = u.rol === 'admin';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={trabajando} aria-label="Acciones">
            {trabajando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={esYo || !u.activo}
            onSelect={() => onEntrarComo(u)}
          >
            <LogIn /> Entrar como
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPwdOpen(true)}>
            <KeyRound /> Restablecer contraseña
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Otorgar/quitar el rol de administrador. No te podés quitar el rol a vos mismo (el
              backend lo bloquea para no dejar el sistema sin admins / sin acceso al panel). */}
          <DropdownMenuItem disabled={esYo && esAdmin} onSelect={() => onToggleRol(u)}>
            {esAdmin ? <ShieldOff /> : <ShieldCheck />}{' '}
            {esAdmin ? 'Quitar admin' : 'Hacer admin'}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={esYo}
            onSelect={() => onToggleActivo(u)}
            className={u.activo ? 'text-danger focus:text-danger' : ''}
          >
            <Power /> {u.activo ? 'Desactivar' : 'Activar'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RestablecerPasswordDialog usuario={u} open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}

// --- Tab: Cuentas ---

// Columnas por las que se puede ordenar la tabla de cuentas (las "Acciones" no se ordenan).
type ColumnaOrden =
  | 'contador'
  | 'clientes'
  | 'alta'
  | 'acceso'
  | 'cierre'
  | 'correo'
  | 'estado';

// Valor comparable de una cuenta para una columna dada. Devuelve null cuando el dato no existe
// (esos van siempre al final). Las fechas se comparan por timestamp; los badges por un orden lógico.
function valorOrden(u: AdminUsuario, col: ColumnaOrden): string | number | null {
  const ts = (iso?: string | null) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : t;
  };
  switch (col) {
    case 'contador':
      return `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
    case 'clientes':
      return u.clientes ?? 0;
    case 'alta':
      return ts(u.creado_en);
    case 'acceso':
      return ts(u.ultimo_acceso);
    case 'cierre':
      return ts(u.ultimo_logout);
    case 'correo':
      return u.email_confirmado ? 1 : 0;
    case 'estado':
      return u.activo ? 1 : 0;
  }
}

// Encabezado clicleable que ordena la tabla por su columna y muestra la flecha del sentido actual.
function EncabezadoOrden({
  col,
  orden,
  onOrdenar,
  children,
  className,
}: {
  col: ColumnaOrden;
  orden: { col: ColumnaOrden; dir: 'asc' | 'desc' } | null;
  onOrdenar: (col: ColumnaOrden) => void;
  children: ReactNode;
  className?: string;
}) {
  const activo = orden?.col === col;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onOrdenar(col)}
        className={cn(
          'inline-flex items-center gap-1 select-none hover:text-foreground transition-colors',
          activo ? 'text-foreground font-semibold' : ''
        )}
        title="Ordenar por esta columna"
      >
        {children}
        {activo ? (
          orden!.dir === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

function TabCuentas({ miId, onImpersonar }: { miId?: number; onImpersonar: () => void }) {
  const qc = useQueryClient();
  const {
    data: usuarios = [],
    isLoading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({ queryKey: ['admin', 'usuarios'], queryFn: listarUsuarios });
  const [busqueda, setBusqueda] = useState('');
  const [accionando, setAccionando] = useState<number | null>(null);
  const [accionError, setAccionError] = useState('');
  const [fichaId, setFichaId] = useState<number | null>(null);

  // Ordenamiento por columna (clic en el encabezado alterna asc/desc). Default: últimos accesos
  // primero (los que nunca accedieron quedan al final por el manejo de nulos en valorOrden).
  const [orden, setOrden] = useState<{ col: ColumnaOrden; dir: 'asc' | 'desc' } | null>({
    col: 'acceso',
    dir: 'desc',
  });

  const filtrados = useMemo(() => {
    // Cada palabra de la búsqueda debe aparecer en el texto combinado de la cuenta. Así "Juan Pérez"
    // matchea aunque nombre y apellido sean campos distintos (con .some() por campo fallaba).
    const tokens = busqueda.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return usuarios;
    return usuarios.filter(u => {
      const heno = [u.nombre, u.apellido, u.email, u.estudio, u.cuit]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return tokens.every(t => heno.includes(t));
    });
  }, [usuarios, busqueda]);

  const ordenados = useMemo(() => {
    if (!orden) return filtrados;
    const dir = orden.dir === 'asc' ? 1 : -1;
    const arr = [...filtrados].sort((a, b) => {
      const va = valorOrden(a, orden.col);
      const vb = valorOrden(b, orden.col);
      // Los valores ausentes (null) van siempre al final, sin importar la dirección.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb, 'es') * dir;
      }
      return ((va as number) - (vb as number)) * dir;
    });
    return arr;
  }, [filtrados, orden]);

  function ordenarPor(col: ColumnaOrden) {
    setOrden(prev =>
      prev?.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }
    );
  }

  async function toggleActivo(u: AdminUsuario) {
    setAccionando(u.id);
    setAccionError('');
    try {
      const actualizado = await editarUsuario(u.id, { activo: !u.activo });
      // Actualiza la fila en cache (sin refetch) y revalida las métricas (cambió el conteo de activas).
      qc.setQueryData<AdminUsuario[]>(['admin', 'usuarios'], prev =>
        prev ? prev.map(x => (x.id === u.id ? actualizado : x)) : prev
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'metricas'] });
    } catch (e) {
      setAccionError(mensajeDeError(e));
    } finally {
      setAccionando(null);
    }
  }

  async function toggleRol(u: AdminUsuario) {
    const nuevoRol = u.rol === 'admin' ? 'contador' : 'admin';
    const accion = nuevoRol === 'admin' ? 'darle acceso de administrador a' : 'quitarle el acceso de administrador a';
    if (!window.confirm(`¿Seguro que querés ${accion} ${u.nombre} ${u.apellido} (${u.email})?`)) {
      return;
    }
    setAccionando(u.id);
    setAccionError('');
    try {
      const actualizado = await editarUsuario(u.id, { rol: nuevoRol });
      qc.setQueryData<AdminUsuario[]>(['admin', 'usuarios'], prev =>
        prev ? prev.map(x => (x.id === u.id ? actualizado : x)) : prev
      );
      // Cambió el conteo de administradores del dashboard.
      void qc.invalidateQueries({ queryKey: ['admin', 'metricas'] });
    } catch (e) {
      setAccionError(mensajeDeError(e));
    } finally {
      setAccionando(null);
    }
  }

  async function entrarComo(u: AdminUsuario) {
    setAccionando(u.id);
    setAccionError('');
    try {
      const auth = await impersonar(u.id);
      iniciarImpersonacion(auth);
      onImpersonar();
    } catch (e) {
      setAccionError(mensajeDeError(e));
      setAccionando(null);
    }
  }

  if (fichaId !== null) {
    return (
      <FichaContador
        id={fichaId}
        miId={miId}
        onVolver={() => setFichaId(null)}
        onImpersonar={onImpersonar}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando cuentas…
      </div>
    );
  }

  const error = accionError || (queryError ? mensajeDeError(queryError) : '');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, email, estudio o CUIT…"
            className="pl-9"
          />
        </div>
        <BotonActualizar refetch={refetch} isFetching={isFetching} />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <EncabezadoOrden col="contador" orden={orden} onOrdenar={ordenarPor}>
                Contador
              </EncabezadoOrden>
              <EncabezadoOrden col="clientes" orden={orden} onOrdenar={ordenarPor} className="text-center">
                Clientes
              </EncabezadoOrden>
              <EncabezadoOrden col="alta" orden={orden} onOrdenar={ordenarPor}>
                Alta
              </EncabezadoOrden>
              <EncabezadoOrden col="acceso" orden={orden} onOrdenar={ordenarPor}>
                Último acceso
              </EncabezadoOrden>
              <EncabezadoOrden col="cierre" orden={orden} onOrdenar={ordenarPor}>
                Último cierre
              </EncabezadoOrden>
              <EncabezadoOrden col="correo" orden={orden} onOrdenar={ordenarPor} className="text-center">
                Correo
              </EncabezadoOrden>
              <EncabezadoOrden col="estado" orden={orden} onOrdenar={ordenarPor} className="text-center">
                Estado
              </EncabezadoOrden>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenados.map(u => (
              <TableRow key={u.id}>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => setFichaId(u.id)}
                    className="group text-left"
                    title="Ver ficha del contador"
                  >
                    <div className="font-medium flex items-center gap-2 group-hover:text-primary">
                      {u.nombre} {u.apellido}
                      {u.rol === 'admin' && (
                        <Badge variant="default" className="text-[10px]">
                          <ShieldCheck className="h-3 w-3" /> admin
                        </Badge>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </button>
                </TableCell>
                <TableCell className="text-center tabular-nums">{u.clientes}</TableCell>
                <TableCell className="text-sm">{fechaCorta(u.creado_en)}</TableCell>
                <TableCell className="text-sm">{fechaHora(u.ultimo_acceso)}</TableCell>
                <TableCell className="text-sm">{fechaHora(u.ultimo_logout)}</TableCell>
                <TableCell className="text-center">
                  <EmailConfirmadoBadge confirmado={u.email_confirmado} />
                </TableCell>
                <TableCell className="text-center">
                  {u.activo ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="muted">Inhabilitada</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end">
                    <AccionesCuenta
                      u={u}
                      miId={miId}
                      trabajando={accionando === u.id}
                      onEntrarComo={u => void entrarComo(u)}
                      onToggleActivo={u => void toggleActivo(u)}
                      onToggleRol={u => void toggleRol(u)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {ordenados.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  No hay cuentas que coincidan con la búsqueda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 lg:hidden">
        {ordenados.map(u => (
          <Card key={u.id} className="space-y-3 p-4">
            <button
              type="button"
              onClick={() => setFichaId(u.id)}
              className="flex w-full items-start justify-between gap-2 text-left"
              title="Ver ficha del contador"
            >
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {u.nombre} {u.apellido}
                  {u.rol === 'admin' && (
                    <Badge variant="default" className="text-[10px]">
                      <ShieldCheck className="h-3 w-3" /> admin
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground break-all">{u.email}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {u.activo ? (
                <Badge variant="success">Activa</Badge>
              ) : (
                <Badge variant="muted">Inhabilitada</Badge>
              )}
              <EmailConfirmadoBadge confirmado={u.email_confirmado} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {u.clientes} cliente(s)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-[11px] uppercase tracking-wider">Alta</span>
                {fechaCorta(u.creado_en)}
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider">Último acceso</span>
                {fechaHora(u.ultimo_acceso)}
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider">Último cierre</span>
                {fechaHora(u.ultimo_logout)}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <AccionesCuenta
                u={u}
                miId={miId}
                trabajando={accionando === u.id}
                onEntrarComo={u => void entrarComo(u)}
                onToggleActivo={u => void toggleActivo(u)}
                onToggleRol={u => void toggleRol(u)}
              />
            </div>
          </Card>
        ))}
        {ordenados.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No hay cuentas que coincidan con la búsqueda.
          </Card>
        )}
      </div>
    </div>
  );
}

// --- Tab: Motor de sincronización ---

function haceTexto(h?: number | null): string {
  if (h == null) return 'nunca';
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 48) return `hace ${h.toFixed(1)} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Cuánto tardó una sincronización, en segundos → "12s" / "1m 30s" / "2m". */
function duracionTexto(seg?: number | null): string {
  if (seg == null) return '—';
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function ClientesTabla({
  filas,
  modo,
  pageSize,
}: {
  filas: MotorCliente[];
  modo: 'cola' | 'actividad';
  pageSize?: number; // si se pasa, pagina la tabla de a `pageSize` filas
}) {
  const [pagina, setPagina] = useState(0);
  const totalPaginas = pageSize ? Math.max(1, Math.ceil(filas.length / pageSize)) : 1;
  // Clamp: si los datos se achican (auto-refresh) y la página quedó fuera de rango, la traemos al tope.
  const pag = Math.min(pagina, totalPaginas - 1);
  const visibles = pageSize ? filas.slice(pag * pageSize, (pag + 1) * pageSize) : filas;
  const cols = modo === 'actividad' ? 6 : 3;

  const paginacion = pageSize && totalPaginas > 1 && (
    <div className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">
        {filas.length} en total · página {pag + 1} de {totalPaginas}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={pag === 0}
          onClick={() => setPagina(p => Math.max(0, p - 1))}
        >
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pag >= totalPaginas - 1}
          onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
        >
          Siguiente <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Contador</TableHead>
              {modo === 'actividad' ? (
                <>
                  <TableHead className="text-center">Resultado</TableHead>
                  <TableHead className="text-right">Nuevos</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead className="text-right">Cuándo</TableHead>
                </>
              ) : (
                <TableHead className="text-right">Última sync</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((f, i) => (
              <TableRow key={`${f.cuit}-${f.ultima ?? ''}-${i}`}>
                <TableCell className="text-sm">
                  <div>{f.cliente || '—'}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{f.cuit}</div>
                </TableCell>
                <TableCell className="text-sm">{f.contador_email || '—'}</TableCell>
                {modo === 'actividad' ? (
                  <>
                    <TableCell className="text-center">
                      {f.resultado === 'exitosa' ? (
                        <Badge variant="success">OK</Badge>
                      ) : (
                        <Badge variant="danger">Falló</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {f.comprobantes ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums whitespace-nowrap">
                      {duracionTexto(f.duracion_seg)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {haceTexto(f.horas_desde)}
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                    {haceTexto(f.horas_desde)}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filas.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols} className="text-center text-muted-foreground py-8">
                  {modo === 'cola' ? 'No hay clientes pendientes: está todo al día. 🎉' : 'Sin actividad reciente.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {paginacion}
      </Card>

      <div className="lg:hidden">
        <div className="space-y-3">
          {visibles.map((f, i) => (
            <Card key={`${f.cuit}-${f.ultima ?? ''}-${i}`} className="space-y-2 p-4 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{f.cliente || '—'}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{f.cuit}</div>
                </div>
                {modo === 'actividad' &&
                  (f.resultado === 'exitosa' ? (
                    <Badge variant="success">OK</Badge>
                  ) : (
                    <Badge variant="danger">Falló</Badge>
                  ))}
              </div>
              <div className="text-xs text-muted-foreground break-all">
                {f.contador_email || '—'}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {modo === 'actividad' ? (
                  <>
                    <span className="tabular-nums">{f.comprobantes ?? '—'} nuevos</span>
                    <span className="tabular-nums whitespace-nowrap">{duracionTexto(f.duracion_seg)}</span>
                    <span className="whitespace-nowrap">{haceTexto(f.horas_desde)}</span>
                  </>
                ) : (
                  <span className="ml-auto whitespace-nowrap">
                    última sync {haceTexto(f.horas_desde)}
                  </span>
                )}
              </div>
            </Card>
          ))}
          {filas.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {modo === 'cola' ? 'No hay clientes pendientes: está todo al día. 🎉' : 'Sin actividad reciente.'}
            </Card>
          )}
        </div>
        {paginacion && <Card className="mt-3 overflow-hidden">{paginacion}</Card>}
      </div>
    </>
  );
}

function TabMotor() {
  // refetchInterval mantiene la tab "en vivo"; staleTime corto para que al volver muestre el cache al
  // instante y revalide enseguida. React Query frena el polling solo cuando la tab no está montada.
  const {
    data: m,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ['admin', 'motor'],
    queryFn: obtenerEstadoMotor,
    refetchInterval: 8000,
    staleTime: 4000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando estado del motor…
      </div>
    );
  }
  if (queryError || !m) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {queryError ? mensajeDeError(queryError) : 'No se pudo cargar el motor.'}
      </div>
    );
  }

  const exito = m.syncs_24h ? Math.round((m.exitosas_24h / m.syncs_24h) * 100) : null;

  // Duración promedio de sync (segundos del backend) → "2m 45s" / "45s" / "—".
  const dp = m.duracion_promedio_seg;
  const durPromTexto =
    dp == null
      ? '—'
      : dp < 60
        ? `${dp}s`
        : dp % 60 === 0
          ? `${dp / 60}m`
          : `${Math.floor(dp / 60)}m ${dp % 60}s`;

  return (
    <div className="space-y-6">
      {/* Estado del worker */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full',
                m.worker_vivo ? 'bg-success animate-pulse' : 'bg-danger'
              )}
            />
            <span className="font-semibold">
              {m.worker_vivo ? 'Motor activo' : 'Motor caído'}
            </span>
            <span className="text-xs text-muted-foreground">
              último latido {haceTexto((Date.now() - new Date(m.worker_actualizado ?? 0).getTime()) / 3600000)}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Concurrencia <span className="font-medium text-foreground">{m.concurrencia}</span> · Refresco cada{' '}
            <span className="font-medium text-foreground">{m.intervalo_horas} h</span>
          </div>
        </div>

        {/* Sincronizando ahora */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Sincronizando ahora ({m.en_vuelo.length})
          </div>
          {m.en_vuelo.length === 0 ? (
            <div className="text-sm text-muted-foreground">El motor está en reposo en este momento.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {m.en_vuelo.map(c => (
                <Badge key={c.cuit} variant="default" className="gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {c.cliente || c.cuit}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Cobertura */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Cobertura</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricaCard icon={Building2} label="Clientes totales" valor={m.total_clientes} />
          <MetricaCard icon={CheckCircle2} label="Al día (<12h)" valor={m.frescos} />
          <MetricaCard icon={Clock} label="Pendientes" valor={m.pendientes} />
          <MetricaCard icon={RefreshCcw} label="Nunca sincronizados" valor={m.nunca} />
          <MetricaCard icon={AlertTriangle} label="Con falla actual" valor={m.con_falla_actual} />
        </div>
      </div>

      {/* Rendimiento */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Rendimiento</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricaCard icon={Zap} label="Syncs última hora" valor={m.syncs_1h} />
          <MetricaCard icon={Activity} label="Syncs últimas 24h" valor={m.syncs_24h} />
          <MetricaCard
            icon={CheckCircle2}
            label="Tasa de éxito 24h"
            valor={exito == null ? '—' : `${exito}%`}
            hint={`${m.exitosas_24h} ok · ${m.fallidas_24h} con falla`}
          />
          <MetricaCard
            icon={Timer}
            label="Tiempo promedio de sync"
            valor={durPromTexto}
            hint="exitosas, últimas 24h"
          />
          <MetricaCard icon={Clock} label="En cola" valor={m.proximos.length} hint="próximos a sincronizar" />
        </div>
      </div>

      {/* Próximos + Actividad */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" /> Próximos a sincronizar
          </h2>
          <ClientesTabla filas={m.proximos} modo="cola" />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" /> Actividad reciente
          </h2>
          <ClientesTabla filas={m.actividad} modo="actividad" pageSize={10} />
        </div>
      </div>
    </div>
  );
}

// --- Tab: Métricas ---

function MetricaCard({
  icon: Icon,
  label,
  valor,
  hint,
}: {
  icon: typeof Users;
  label: string;
  valor: number | string;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none">{valor}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-3">{hint}</div>}
    </Card>
  );
}

function TabMetricas() {
  const { data: m, isLoading, error: queryError } = useQuery({
    queryKey: ['admin', 'metricas'],
    queryFn: obtenerMetricas,
    staleTime: 10_000,
  });
  const { data: fallidas = [] } = useQuery({
    queryKey: ['admin', 'fallidas'],
    queryFn: listarSincronizacionesFallidas,
  });
  const { data: avisosNombre = [] } = useQuery({
    queryKey: ['admin', 'avisos-nombre'],
    queryFn: listarAvisosNombre,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando métricas…
      </div>
    );
  }
  if (queryError || !m) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {queryError ? mensajeDeError(queryError) : 'No se pudieron cargar las métricas.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricaCard icon={Users} label="Cuentas totales" valor={m.total_cuentas} />
        <MetricaCard icon={UserCheck} label="Cuentas activas" valor={m.cuentas_activas} />
        <MetricaCard
          icon={MailCheck}
          label="Mails confirmados"
          valor={m.mails_confirmados}
          hint={`de ${m.total_cuentas}`}
        />
        <MetricaCard icon={UserX} label="Cuentas inhabilitadas" valor={m.cuentas_inactivas} />
        <MetricaCard icon={ShieldCheck} label="Administradores" valor={m.total_admins} />
        <MetricaCard icon={Building2} label="Clientes en el sistema" valor={m.total_clientes} />
        <MetricaCard
          icon={RefreshCcw}
          label="Sincronizaciones hoy"
          valor={m.syncs_hoy}
          hint={m.syncs_fallidas_hoy > 0 ? `${m.syncs_fallidas_hoy} con problemas` : 'sin problemas'}
        />
        <MetricaCard
          icon={Users}
          label="Altas en la semana"
          valor={m.nuevas_cuentas_semana}
          hint="últimos 7 días"
        />
      </div>

      <SyncsFallidas fallidas={fallidas} />
      <AvisosNombre avisos={avisosNombre} />
    </div>
  );
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Un cliente (cuit) con TODAS sus sincronizaciones fallidas agrupadas. La primera de `items` es la
// más reciente (el backend las manda ordenadas por fecha desc), así que define el estado actual.
interface GrupoFallidas {
  cuit: string;
  cliente?: string | null;
  contador_email?: string | null;
  items: AdminSyncFallida[];
}

// Log de sincronizaciones con problemas (vista de ops: motivo técnico + estado actual + reintento).
// La lista es POR CLIENTE: cada cuit aparece una sola vez y se despliega para ver todos sus errores.
function SyncsFallidas({ fallidas }: { fallidas: AdminSyncFallida[] }) {
  const qc = useQueryClient();
  // Estado de reintento por cuit: 'corriendo' mientras poolea el job; mensaje de error si falló.
  const [reintentando, setReintentando] = useState<Record<string, boolean>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  // Qué clientes tienen el detalle de errores desplegado.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  // Agrupa las filas por cuit conservando el orden de aparición (fecha desc del backend).
  const grupos = useMemo<GrupoFallidas[]>(() => {
    const mapa = new Map<string, GrupoFallidas>();
    for (const f of fallidas) {
      let g = mapa.get(f.cuit);
      if (!g) {
        g = { cuit: f.cuit, cliente: f.cliente, contador_email: f.contador_email, items: [] };
        mapa.set(f.cuit, g);
      }
      g.items.push(f);
      // Completa nombre/contador si alguna fila del grupo los trae y todavía faltaban.
      if (!g.cliente && f.cliente) g.cliente = f.cliente;
      if (!g.contador_email && f.contador_email) g.contador_email = f.contador_email;
    }
    return [...mapa.values()];
  }, [fallidas]);

  const toggle = (cuit: string) => setAbiertos(prev => ({ ...prev, [cuit]: !prev[cuit] }));

  async function reintentar(cuit: string) {
    setReintentando(prev => ({ ...prev, [cuit]: true }));
    setErrores(prev => ({ ...prev, [cuit]: '' }));
    try {
      const { job_id } = await reintentarSync(cuit);
      // El sync es pesado (puede tardar varios minutos): pooleamos cada 3s hasta que termine.
      for (let intento = 0; intento < 140; intento++) {
        await sleep(3000);
        const j = await estadoSync(job_id);
        if (j.estado === 'terminado') break;
        if (j.estado === 'error') {
          setErrores(prev => ({ ...prev, [cuit]: j.error || 'No se pudo sincronizar.' }));
          break;
        }
      }
      // Revalida lo afectado: la fila puede pasar a "Resuelto" y cambian métricas/motor.
      void qc.invalidateQueries({ queryKey: ['admin', 'fallidas'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'metricas'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'motor'] });
    } catch (e) {
      setErrores(prev => ({ ...prev, [cuit]: mensajeDeError(e) }));
    } finally {
      setReintentando(prev => ({ ...prev, [cuit]: false }));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning-foreground" />
        <h2 className="text-sm font-semibold">Clientes con sincronizaciones con problemas</h2>
        <Badge variant={grupos.length ? 'warning' : 'muted'}>{grupos.length}</Badge>
      </div>

      {grupos.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No hay sincronizaciones con problemas recientes. 🎉
        </Card>
      ) : (
        <>
          {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contador</TableHead>
                  <TableHead className="text-center">Errores</TableHead>
                  <TableHead className="text-center">Estado actual</TableHead>
                  <TableHead>Último problema</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grupos.map(g => {
                  const corriendo = reintentando[g.cuit];
                  const err = errores[g.cuit];
                  const reciente = g.items[0];
                  const abierto = abiertos[g.cuit];
                  return (
                    <Fragment key={g.cuit}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => toggle(g.cuit)}
                      >
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1.5">
                            {abierto ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0">
                              <div>{g.cliente || '—'}</div>
                              <div className="text-xs text-muted-foreground tabular-nums">{g.cuit}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{g.contador_email || '—'}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="muted">{g.items.length}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {reciente.resuelto ? (
                            <Badge variant="success" title={`Sincronizado después: ${fechaHora(reciente.ultima_sync_ok)}`}>
                              <CheckCircle2 className="h-3 w-3" /> Resuelto
                            </Badge>
                          ) : (
                            <Badge variant="danger">Sin resolver</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">{fechaHora(reciente.fecha)}</div>
                          <code
                            className="block max-w-sm truncate font-mono text-xs text-danger"
                            title={reciente.motivo || ''}
                          >
                            {(reciente.motivo || '—').split('\n')[0]}
                          </code>
                          {err && <div className="text-xs text-danger mt-1">{err}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          {reciente.resuelto ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={corriendo}
                              onClick={e => {
                                e.stopPropagation();
                                void reintentar(g.cuit);
                              }}
                              title="Volver a intentar la sincronización de este cliente"
                            >
                              {corriendo ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" /> Reintentando…
                                </>
                              ) : (
                                <>
                                  <RotateCw className="h-4 w-4" /> Reintentar
                                </>
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {abierto && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="py-2">
                            <ul className="space-y-1.5 pl-6">
                              {g.items.map((f, j) => (
                                <li key={`${f.fecha}-${j}`} className="flex items-start gap-3 text-xs">
                                  <span className="w-32 shrink-0 whitespace-nowrap text-muted-foreground">
                                    {fechaHora(f.fecha)}
                                  </span>
                                  <code
                                    className="min-w-0 flex-1 font-mono text-danger break-words"
                                    title={f.motivo || ''}
                                  >
                                    {f.motivo || '—'}
                                  </code>
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-3 lg:hidden">
            {grupos.map(g => {
              const corriendo = reintentando[g.cuit];
              const err = errores[g.cuit];
              const reciente = g.items[0];
              const abierto = abiertos[g.cuit];
              return (
                <Card key={g.cuit} className="space-y-2 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{g.cliente || '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{g.cuit}</div>
                    </div>
                    {reciente.resuelto ? (
                      <Badge variant="success" title={`Sincronizado después: ${fechaHora(reciente.ultima_sync_ok)}`}>
                        <CheckCircle2 className="h-3 w-3" /> Resuelto
                      </Badge>
                    ) : (
                      <Badge variant="danger">Sin resolver</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground break-all">
                    {g.contador_email || '—'}
                  </div>

                  <button
                    type="button"
                    onClick={() => toggle(g.cuit)}
                    className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground"
                  >
                    {abierto ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    {g.items.length} {g.items.length === 1 ? 'error' : 'errores'}
                  </button>

                  {abierto ? (
                    <ul className="space-y-2 border-l pl-3">
                      {g.items.map((f, j) => (
                        <li key={`${f.fecha}-${j}`} className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">{fechaHora(f.fecha)}</div>
                          <code
                            className="block font-mono text-xs text-danger break-words"
                            title={f.motivo || ''}
                          >
                            {f.motivo || '—'}
                          </code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <code
                      className="block font-mono text-xs text-danger break-words"
                      title={reciente.motivo || ''}
                    >
                      {(reciente.motivo || '—').split('\n')[0]}
                    </code>
                  )}

                  {err && <div className="text-xs text-danger">{err}</div>}
                  {!reciente.resuelto && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={corriendo}
                      onClick={() => void reintentar(g.cuit)}
                    >
                      {corriendo ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Reintentando…
                        </>
                      ) : (
                        <>
                          <RotateCw className="h-4 w-4" /> Reintentar
                        </>
                      )}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Avisos (NO fallos) dentro del panel de problemas: clientes cuyo nombre quedó como "Titular <CUIT>"
// al darse de alta (no se pudo leer el nombre real). Se resuelve renombrándolos a mano desde la
// ficha; el aviso desaparece solo cuando el nombre efectivo deja de empezar con "Titular".
function AvisosNombre({ avisos }: { avisos: AdminAvisoNombre[] }) {
  if (avisos.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning-foreground" />
        <h2 className="text-sm font-semibold">Clientes con el nombre sin confirmar</h2>
        <Badge variant="warning">{avisos.length}</Badge>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        Quedaron cargados como «Titular …» porque no se pudo leer su nombre. Renombralos a mano desde
        la ficha del cliente; el aviso se va solo al hacerlo.
      </p>

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Contador</TableHead>
              <TableHead className="text-right">Acción sugerida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {avisos.map(a => (
              <TableRow key={a.cuit}>
                <TableCell className="text-sm">
                  <div>{a.cliente || '—'}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{a.cuit}</div>
                </TableCell>
                <TableCell className="text-sm">{a.contador_email || '—'}</TableCell>
                <TableCell className="text-right text-xs text-warning-foreground">
                  Renombrar desde la ficha
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 lg:hidden">
        {avisos.map(a => (
          <Card key={a.cuit} className="space-y-1 p-4 text-sm">
            <div className="font-medium">{a.cliente || '—'}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{a.cuit}</div>
            <div className="text-xs text-muted-foreground break-all">{a.contador_email || '—'}</div>
            <div className="text-xs text-warning-foreground">Renombrar desde la ficha del cliente</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Tab: Clientes (vista global read-only de todos los clientes de todas las cuentas) ---

function pesos(n?: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

function regimenCorto(r?: string | null): string {
  if (r === 'monotributo') return 'Monotributo';
  if (r === 'responsable_inscripto') return 'Resp. Inscripto';
  if (r === 'no_monotributo') return 'No monotributo';
  return '—';
}

/** Facturado de los últimos 12m calculado de los comprobantes (emitidas netas), igual que el dashboard. */
function facturado12m(c: AdminCliente): number {
  return (c.historial_mensual || []).reduce((s, m) => s + (m.emitidasNetas || 0), 0);
}

function TabClientes() {
  const {
    data: clientes = [],
    isLoading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({ queryKey: ['admin', 'clientes'], queryFn: listarTodosLosClientes });
  const [busqueda, setBusqueda] = useState('');
  const error = queryError ? mensajeDeError(queryError) : '';

  const filtrados = useMemo(() => {
    // Mismo criterio que en Cuentas: cada palabra debe aparecer en el texto combinado del cliente.
    const tokens = busqueda.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return clientes;
    return clientes.filter(c => {
      const heno = [c.nombre, c.cuit, c.contador_email, c.contador_nombre, c.categoria]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return tokens.every(t => heno.includes(t));
    });
  }, [clientes, busqueda]);

  const totalFacturado = useMemo(
    () => filtrados.reduce((s, c) => s + facturado12m(c), 0),
    [filtrados]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando clientes…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, CUIT, contador o categoría…"
            className="pl-9"
          />
        </div>
        <BotonActualizar refetch={refetch} isFetching={isFetching} />
      </div>

      <div className="text-xs text-muted-foreground">
        {filtrados.length} cliente(s) · facturado 12m sumado: {pesos(totalFacturado)} · sólo lectura
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <TablaClientes clientes={filtrados} mostrarContador />
    </div>
  );
}

/** Tabla de clientes reutilizable: la usa la vista global (con columna Contador) y la ficha de un
 * contador (sin esa columna). Read-only. */
function TablaClientes({
  clientes,
  mostrarContador,
}: {
  clientes: AdminCliente[];
  mostrarContador: boolean;
}) {
  const cols = mostrarContador ? 7 : 6;

  function EstadoSync({ c }: { c: AdminCliente }) {
    return (
      <>
        <div className="flex items-center gap-2">
          {c.resultado_ultima_extraccion === 'exitosa' ? (
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3" /> OK
            </Badge>
          ) : c.resultado_ultima_extraccion === 'fallida' ? (
            <Badge variant="danger">falló</Badge>
          ) : (
            <Badge variant="muted">sin datos</Badge>
          )}
          <span className="text-muted-foreground whitespace-nowrap">
            {fechaCorta(c.ultima_extraccion)}
          </span>
        </div>
        {c.resultado_ultima_extraccion === 'fallida' && c.motivo_ultima_extraccion && (
          <div
            className="text-xs text-danger truncate max-w-xs"
            title={c.motivo_ultima_extraccion}
          >
            {c.motivo_ultima_extraccion.split('\n')[0]}
          </div>
        )}
      </>
    );
  }

  function CuotaBadge({ c }: { c: AdminCliente }) {
    return c.cuota_estado === 'al-dia' ? (
      <Badge variant="success">al día</Badge>
    ) : c.cuota_estado === 'con-deuda' ? (
      <Badge variant="warning">con deuda</Badge>
    ) : (
      <span className="text-muted-foreground text-xs">—</span>
    );
  }

  return (
    <>
      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              {mostrarContador && <TableHead>Contador</TableHead>}
              <TableHead className="text-center">Régimen / Cat.</TableHead>
              <TableHead className="text-right">Facturado 12m</TableHead>
              <TableHead className="text-center">Comprob.</TableHead>
              <TableHead className="text-center">Cuota</TableHead>
              <TableHead>Última sincronización</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientes.map(c => (
              <TableRow key={c.cuit}>
                <TableCell>
                  <div className="font-medium">{c.nombre}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{c.cuit}</div>
                </TableCell>
                {mostrarContador && (
                  <TableCell className="text-sm">{c.contador_email || '—'}</TableCell>
                )}
                <TableCell className="text-center text-sm">
                  {regimenCorto(c.regimen)}
                  {c.categoria ? <span className="text-muted-foreground"> · {c.categoria}</span> : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pesos(facturado12m(c))}</TableCell>
                <TableCell className="text-center tabular-nums">{c.cantidad_comprobantes}</TableCell>
                <TableCell className="text-center">
                  <CuotaBadge c={c} />
                </TableCell>
                <TableCell className="text-sm">
                  <EstadoSync c={c} />
                </TableCell>
              </TableRow>
            ))}
            {clientes.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols} className="text-center text-muted-foreground py-10">
                  Este contador todavía no tiene clientes.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 lg:hidden">
        {clientes.map(c => (
          <Card key={c.cuit} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{c.nombre}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{c.cuit}</div>
                {mostrarContador && (
                  <div className="text-xs text-muted-foreground break-all">
                    {c.contador_email || '—'}
                  </div>
                )}
              </div>
              <CuotaBadge c={c} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Régimen / Cat.
                </span>
                {regimenCorto(c.regimen)}
                {c.categoria ? <span className="text-muted-foreground"> · {c.categoria}</span> : ''}
              </div>
              <div className="text-right">
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Facturado 12m
                </span>
                <span className="tabular-nums">{pesos(facturado12m(c))}</span>
              </div>
              <div>
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Comprob.
                </span>
                <span className="tabular-nums">{c.cantidad_comprobantes}</span>
              </div>
            </div>

            <div className="border-t border-border/50 pt-2 text-sm">
              <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Última sincronización
              </span>
              <EstadoSync c={c} />
            </div>
          </Card>
        ))}
        {clientes.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Este contador todavía no tiene clientes.
          </Card>
        )}
      </div>
    </>
  );
}

// --- Ficha de un contador (vista detallada read-only) ---

function Dato({ label, valor }: { label: string; valor?: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{valor || '—'}</div>
    </div>
  );
}

function FichaContador({
  id,
  miId,
  onVolver,
  onImpersonar,
}: {
  id: number;
  miId?: number;
  onVolver: () => void;
  onImpersonar: () => void;
}) {
  const { data: ficha, isLoading, error: queryError } = useQuery({
    queryKey: ['admin', 'ficha', id],
    queryFn: () => obtenerFichaContador(id),
  });
  const [accionando, setAccionando] = useState(false);
  const [accionError, setAccionError] = useState('');

  async function entrarComo() {
    setAccionando(true);
    setAccionError('');
    try {
      const auth = await impersonar(id);
      iniciarImpersonacion(auth);
      onImpersonar();
    } catch (e) {
      setAccionError(mensajeDeError(e));
      setAccionando(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando ficha…
      </div>
    );
  }
  const error = accionError || (queryError ? mensajeDeError(queryError) : '');
  if (error || !ficha) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onVolver}>
          <ArrowLeft className="h-4 w-4" /> Volver a cuentas
        </Button>
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4" /> {error || 'No se pudo cargar la ficha.'}
        </div>
      </div>
    );
  }

  const u = ficha.usuario;
  const r = ficha.resumen;
  const iniciales = `${u.nombre?.[0] ?? ''}${u.apellido?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onVolver}>
        <ArrowLeft className="h-4 w-4" /> Volver a cuentas
      </Button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary text-lg font-semibold">
            {iniciales}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {u.nombre} {u.apellido}
            </h2>
            <div className="text-sm text-muted-foreground">{u.email}</div>
            <div className="flex items-center gap-2 mt-1">
              {u.rol === 'admin' && (
                <Badge variant="default" className="text-[10px]">
                  <ShieldCheck className="h-3 w-3" /> admin
                </Badge>
              )}
              {u.activo ? (
                <Badge variant="success">Activa</Badge>
              ) : (
                <Badge variant="muted">Inhabilitada</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RestablecerPasswordDialog
            usuario={u}
            trigger={
              <Button variant="outline" size="sm" title="Generar una contraseña temporal">
                <KeyRound className="h-4 w-4" /> Contraseña
              </Button>
            }
          />
          <Button
            variant="outline"
            size="sm"
            disabled={accionando || !u.activo || u.id === miId}
            onClick={() => void entrarComo()}
            title={u.id === miId ? 'Es tu propia cuenta' : 'Entrar como este contador'}
          >
            {accionando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}{' '}
            Entrar como
          </Button>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Dato label="Teléfono" valor={u.telefono} />
          <Dato label="CUIT" valor={u.cuit} />
          <Dato label="Estudio" valor={u.estudio} />
          <Dato label="Matrícula" valor={u.matricula} />
          <Dato label="Alta" valor={fechaCorta(u.creado_en)} />
          <Dato label="Último acceso" valor={fechaHora(u.ultimo_acceso)} />
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricaCard
          icon={Building2}
          label="Clientes"
          valor={r.total_clientes}
          hint={`${r.clientes_con_comprobantes} con datos`}
        />
        <MetricaCard icon={Receipt} label="Comprobantes" valor={r.comprobantes_total} />
        <MetricaCard icon={Activity} label="Facturado 12m" valor={pesos(r.facturado_12m_total)} />
        <MetricaCard
          icon={AlertTriangle}
          label="Con problemas"
          valor={r.syncs_problemas}
          hint={r.syncs_problemas ? 'sincronización sin resolver' : 'todo al día'}
        />
        <MetricaCard
          icon={MessageCircle}
          label="Avisos por WhatsApp"
          valor={r.whatsapp_activo ? 'Activado' : 'Desactivado'}
          hint={r.whatsapp_activo ? 'recibe avisos' : 'no recibe avisos'}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Clientes ({ficha.clientes.length})</h3>
        <TablaClientes clientes={ficha.clientes} mostrarContador={false} />
      </div>
    </div>
  );
}

// --- Tab: Auditoría ---

const ACCION_LABEL: Record<string, { texto: string; variant: 'success' | 'danger' | 'warning' | 'muted' }> = {
  activar: { texto: 'Activó', variant: 'success' },
  desactivar: { texto: 'Desactivó', variant: 'danger' },
  cambiar_rol: { texto: 'Cambió rol', variant: 'warning' },
  impersonar: { texto: 'Entró como', variant: 'muted' },
  restablecer_password: { texto: 'Restableció contraseña', variant: 'warning' },
  reintentar_sync: { texto: 'Reintentó sync', variant: 'muted' },
};

function TabAuditoria() {
  const { data: filas = [], isLoading, error: queryError } = useQuery({
    queryKey: ['admin', 'auditoria'],
    queryFn: listarAuditoria,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando auditoría…
      </div>
    );
  }
  if (queryError) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {mensajeDeError(queryError)}
      </div>
    );
  }

  return (
    <>
      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <Card className="hidden overflow-hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Administrador</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Cuenta afectada</TableHead>
              <TableHead>Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map(f => {
              const a = ACCION_LABEL[f.accion] ?? { texto: f.accion, variant: 'muted' as const };
              return (
                <TableRow key={f.id}>
                  <TableCell className="text-sm whitespace-nowrap">{fechaHora(f.fecha)}</TableCell>
                  <TableCell className="text-sm">{f.admin_email}</TableCell>
                  <TableCell>
                    <Badge variant={a.variant}>{a.texto}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{f.target_email || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{f.detalle || '—'}</TableCell>
                </TableRow>
              );
            })}
            {filas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  Todavía no hay acciones registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="space-y-3 lg:hidden">
        {filas.map(f => {
          const a = ACCION_LABEL[f.accion] ?? { texto: f.accion, variant: 'muted' as const };
          return (
            <Card key={f.id} className="space-y-2 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={a.variant}>{a.texto}</Badge>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {fechaHora(f.fecha)}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Administrador: </span>
                {f.admin_email}
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Cuenta afectada: </span>
                {f.target_email || '—'}
              </div>
              {f.detalle && <div className="text-muted-foreground">{f.detalle}</div>}
            </Card>
          );
        })}
        {filas.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Todavía no hay acciones registradas.
          </Card>
        )}
      </div>
    </>
  );
}
