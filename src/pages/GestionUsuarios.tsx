/**
 * Gestión de usuarios del estudio (sólo cuentas plenas; los usuarios del estudio no la ven).
 *
 * El titular crea cuentas para su equipo (usuario + contraseña), les prende/apaga permisos y les
 * asigna monotributistas. Cada cliente tiene UN responsable: el usuario del estudio ve y opera
 * SÓLO sus asignados; el titular sigue viendo toda la cartera. Los permisos acá sólo se muestran:
 * la validación real la hace el backend en cada acción.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  Search,
  Trash2,
  UserPlus,
  Users,
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
import { PasswordInput } from '@/components/ui/password-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usuarioActual, type PermisoEquipo } from '@/lib/cuenta';
import { qkClientes, useClientesReales } from '@/lib/queries';
import { mensajeDeError } from '@/services/authService';
import {
  asignarCliente,
  crearMiembro,
  editarMiembro,
  eliminarMiembro,
  getMiembros,
  type Miembro,
} from '@/services/equipoService';

const qkMiembros = ['equipo', 'miembros'] as const;

/** Labels de los permisos (espejo de PERMISOS_EQUIPO del backend). Redactados en lenguaje del
 *  contador (regla de producto: nada del mecanismo de obtención de datos). */
const PERMISOS_META: { clave: PermisoEquipo; label: string; detalle: string }[] = [
  {
    clave: 'nuevo_cliente',
    label: 'Dar de alta clientes',
    detalle: 'Puede cargar clientes nuevos; quedan asignados a su cuenta.',
  },
  {
    clave: 'editar_cliente',
    label: 'Editar clientes',
    detalle: 'Notas, categoría, datos de la ficha y pausar/reactivar el seguimiento.',
  },
  {
    clave: 'eliminar_cliente',
    label: 'Eliminar clientes',
    detalle: 'Borrar un cliente con todo su historial.',
  },
  {
    clave: 'actualizar_clave',
    label: 'Actualizar claves fiscales',
    detalle: 'Reemplazar la clave fiscal guardada de un cliente cuando cambia.',
  },
  {
    clave: 'facturar',
    label: 'Emitir comprobantes',
    detalle: 'Facturación electrónica sobre sus clientes asignados.',
  },
  {
    clave: 'conciliacion',
    label: 'Conciliación bancaria',
    detalle: 'Importar extractos y clasificar movimientos.',
  },
  {
    clave: 'comunicaciones',
    label: 'Abrir comunicaciones fiscales',
    detalle: 'Ver el detalle de las comunicaciones del Domicilio Fiscal Electrónico.',
  },
];

function fechaHora(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fila de checkbox de un permiso (compartida por el alta y la edición). */
function FilaPermiso({
  meta,
  activo,
  onCambiar,
}: {
  meta: (typeof PERMISOS_META)[number];
  activo: boolean;
  onCambiar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-muted/50">
      <input
        type="checkbox"
        checked={activo}
        onChange={e => onCambiar(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{meta.label}</span>
        <span className="block text-xs text-muted-foreground">{meta.detalle}</span>
      </span>
    </label>
  );
}

function permisosCompletos(m?: Miembro): Record<PermisoEquipo, boolean> {
  const base = Object.fromEntries(PERMISOS_META.map(p => [p.clave, true])) as Record<
    PermisoEquipo,
    boolean
  >;
  return { ...base, ...(m?.permisos ?? {}) };
}

/** Modal de alta de un usuario del equipo. */
function DialogAlta({
  abierto,
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [permisos, setPermisos] = useState(permisosCompletos());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  function limpiar() {
    setNombre('');
    setApellido('');
    setEmail('');
    setPassword('');
    setPermisos(permisosCompletos());
    setError('');
  }

  async function guardar() {
    if (!nombre.trim() || !apellido.trim() || !email.trim()) {
      setError('Completá nombre, apellido y email.');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña tiene que tener al menos 8 caracteres.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await crearMiembro({ nombre, apellido, email, password, permisos });
      limpiar();
      onCreado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={v => !v && onCerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Agregar usuario</DialogTitle>
          <DialogDescription>
            Creá una cuenta para alguien de tu estudio. Entra con su email y la contraseña que
            definas acá, y ve únicamente los clientes que le asignes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="miembro-nombre">Nombre</Label>
              <Input
                id="miembro-nombre"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ana"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="miembro-apellido">Apellido</Label>
              <Input
                id="miembro-apellido"
                value={apellido}
                onChange={e => setApellido(e.target.value)}
                placeholder="Pérez"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="miembro-email">Email (con el que inicia sesión)</Label>
            <Input
              id="miembro-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ana@estudio.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="miembro-password">Contraseña inicial</Label>
            <PasswordInput
              id="miembro-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              Pasásela por el canal que uses con tu equipo; después puede cambiarla o vos podés
              resetearla desde acá.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Permisos</Label>
            <div className="grid gap-2">
              {PERMISOS_META.map(meta => (
                <FilaPermiso
                  key={meta.clave}
                  meta={meta}
                  activo={permisos[meta.clave]}
                  onCambiar={v => setPermisos(prev => ({ ...prev, [meta.clave]: v }))}
                />
              ))}
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Crear usuario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Modal de edición de permisos de un miembro. */
function DialogPermisos({
  miembro,
  onCerrar,
  onGuardado,
}: {
  miembro: Miembro | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [permisos, setPermisos] = useState<Record<PermisoEquipo, boolean>>(permisosCompletos());
  const [claveInicial, setClaveInicial] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Re-sincroniza el estado local cuando se abre para OTRO miembro (id distinto).
  if (miembro && miembro.id !== claveInicial) {
    setClaveInicial(miembro.id);
    setPermisos(permisosCompletos(miembro));
    setError('');
  }

  async function guardar() {
    if (!miembro) return;
    setGuardando(true);
    setError('');
    try {
      await editarMiembro(miembro.id, { permisos });
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={miembro !== null} onOpenChange={v => !v && onCerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Permisos de {miembro?.nombre} {miembro?.apellido}
          </DialogTitle>
          <DialogDescription>
            Elegí qué puede hacer sobre sus clientes asignados. Lo que apagues deja de estar
            disponible en su cuenta al instante.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {PERMISOS_META.map(meta => (
            <FilaPermiso
              key={meta.clave}
              meta={meta}
              activo={permisos[meta.clave]}
              onCambiar={v => setPermisos(prev => ({ ...prev, [meta.clave]: v }))}
            />
          ))}
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar permisos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Modal para fijarle una contraseña nueva a un miembro (cuando la olvida). */
function DialogPassword({
  miembro,
  onCerrar,
  onGuardado,
}: {
  miembro: Miembro | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    if (!miembro) return;
    if (password.length < 8) {
      setError('La contraseña tiene que tener al menos 8 caracteres.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await editarMiembro(miembro.id, { password });
      setPassword('');
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={miembro !== null} onOpenChange={v => !v && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Nueva contraseña para {miembro?.nombre} {miembro?.apellido}
          </DialogTitle>
          <DialogDescription>
            Fijale una contraseña nueva y pasásela; puede cambiarla cuando quiera.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="miembro-nueva-pass">Contraseña nueva</Label>
          <PasswordInput
            id="miembro-nueva-pass"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmación de eliminación de un miembro (sus clientes vuelven al titular). */
function DialogEliminar({
  miembro,
  onCerrar,
  onEliminado,
}: {
  miembro: Miembro | null;
  onCerrar: () => void;
  onEliminado: () => void;
}) {
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState('');

  async function borrar() {
    if (!miembro) return;
    setBorrando(true);
    setError('');
    try {
      await eliminarMiembro(miembro.id);
      onEliminado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Dialog open={miembro !== null} onOpenChange={v => !v && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            ¿Eliminar a {miembro?.nombre} {miembro?.apellido}?
          </DialogTitle>
          <DialogDescription>
            Su cuenta deja de existir y no puede volver a entrar.{' '}
            {miembro && miembro.clientes > 0
              ? `Sus ${miembro.clientes} cliente(s) asignado(s) pasan a tu cuenta; no se pierde ningún dato.`
              : 'No tiene clientes asignados.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={borrando}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void borrar()} disabled={borrando}>
            {borrando && <Loader2 className="h-4 w-4 animate-spin" />} Eliminar usuario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Menú de acciones de un miembro (permisos / contraseña / activar / eliminar). */
function AccionesMiembro({
  m,
  trabajando,
  onPermisos,
  onPassword,
  onToggleActivo,
  onEliminar,
}: {
  m: Miembro;
  trabajando: boolean;
  onPermisos: (m: Miembro) => void;
  onPassword: (m: Miembro) => void;
  onToggleActivo: (m: Miembro) => void;
  onEliminar: (m: Miembro) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={trabajando} aria-label="Acciones">
          {trabajando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onPermisos(m)}>
          <Pencil /> Editar permisos
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPassword(m)}>
          <KeyRound /> Cambiar contraseña
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onToggleActivo(m)}>
          <Power /> {m.activo ? 'Desactivar cuenta' : 'Activar cuenta'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEliminar(m)} className="text-danger">
          <Trash2 /> Eliminar…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GestionUsuarios() {
  const queryClient = useQueryClient();
  const yo = usuarioActual();
  const {
    data: miembros = [],
    isLoading,
    error: queryError,
  } = useQuery({ queryKey: qkMiembros, queryFn: getMiembros });
  const { data: clientes = [], isLoading: cargandoClientes } = useClientesReales();

  const [dialogAlta, setDialogAlta] = useState(false);
  const [miembroPermisos, setMiembroPermisos] = useState<Miembro | null>(null);
  const [miembroPassword, setMiembroPassword] = useState<Miembro | null>(null);
  const [miembroEliminar, setMiembroEliminar] = useState<Miembro | null>(null);
  const [accionando, setAccionando] = useState<number | null>(null);
  const [asignando, setAsignando] = useState<string | null>(null);
  const [accionError, setAccionError] = useState('');
  const [busqueda, setBusqueda] = useState('');

  function refrescar() {
    void queryClient.invalidateQueries({ queryKey: qkMiembros });
    void queryClient.invalidateQueries({ queryKey: qkClientes });
  }

  async function toggleActivo(m: Miembro) {
    setAccionando(m.id);
    setAccionError('');
    try {
      await editarMiembro(m.id, { activo: !m.activo });
      refrescar();
    } catch (e) {
      setAccionError(mensajeDeError(e));
    } finally {
      setAccionando(null);
    }
  }

  async function reasignar(cuit: string, usuarioId: number) {
    setAsignando(cuit);
    setAccionError('');
    try {
      await asignarCliente(cuit, usuarioId);
      refrescar();
    } catch (e) {
      setAccionError(mensajeDeError(e));
    } finally {
      setAsignando(null);
    }
  }

  // Opciones del selector de responsable: yo (titular) + cada miembro del equipo.
  const opcionesResponsable = useMemo(
    () => [
      { id: yo?.id ?? 0, nombre: 'Mi cuenta' },
      ...miembros.map(m => ({ id: m.id, nombre: `${m.nombre} ${m.apellido}`.trim() })),
    ],
    [yo?.id, miembros]
  );

  const clientesFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!q) return lista;
    return lista.filter(
      c => c.nombre.toLowerCase().includes(q) || c.cuit.includes(q.replace(/\D/g, '') || q)
    );
  }, [clientes, busqueda]);

  const error = accionError || (queryError ? mensajeDeError(queryError) : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gestión de usuarios</h1>
          <p className="text-sm text-muted-foreground">
            Creá cuentas para tu equipo, definí sus permisos y asignales monotributistas. Cada
            usuario ve únicamente los clientes a su cargo.
          </p>
        </div>
        <Button onClick={() => setDialogAlta(true)}>
          <UserPlus className="h-4 w-4" /> Agregar usuario
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* --- Usuarios del equipo ------------------------------------------------ */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando usuarios…
        </div>
      ) : miembros.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div className="max-w-md space-y-1">
            <div className="font-medium">Todavía no creaste usuarios</div>
            <p className="text-sm text-muted-foreground">
              Sumá a las personas de tu estudio: cada una entra con su propia cuenta, ve sólo los
              clientes que le asignes y hace únicamente lo que le permitas.
            </p>
          </div>
          <Button onClick={() => setDialogAlta(true)}>
            <UserPlus className="h-4 w-4" /> Agregar usuario
          </Button>
        </Card>
      ) : (
        <>
          {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas (convención del proyecto). */}
          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead className="text-center">Clientes a cargo</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                  <TableHead>Permisos</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {miembros.map(m => {
                  const apagados = PERMISOS_META.filter(p => m.permisos[p.clave] === false);
                  return (
                    <TableRow key={m.id} className={m.activo ? '' : 'opacity-60'}>
                      <TableCell>
                        <div className="font-medium">
                          {m.nombre} {m.apellido}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{m.clientes}</TableCell>
                      <TableCell className="text-sm">{fechaHora(m.ultimo_acceso)}</TableCell>
                      <TableCell className="text-center">
                        {m.activo ? (
                          <Badge variant="success">Activa</Badge>
                        ) : (
                          <Badge variant="muted">Desactivada</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setMiembroPermisos(m)}
                          className="text-left text-sm text-muted-foreground hover:text-primary"
                          title="Editar permisos"
                        >
                          {apagados.length === 0
                            ? 'Todos'
                            : `${PERMISOS_META.length - apagados.length} de ${PERMISOS_META.length}`}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <AccionesMiembro
                            m={m}
                            trabajando={accionando === m.id}
                            onPermisos={setMiembroPermisos}
                            onPassword={setMiembroPassword}
                            onToggleActivo={m => void toggleActivo(m)}
                            onEliminar={setMiembroEliminar}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-3 lg:hidden">
            {miembros.map(m => (
              <Card key={m.id} className={`space-y-3 p-4 ${m.activo ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {m.nombre} {m.apellido}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <AccionesMiembro
                    m={m}
                    trabajando={accionando === m.id}
                    onPermisos={setMiembroPermisos}
                    onPassword={setMiembroPassword}
                    onToggleActivo={m => void toggleActivo(m)}
                    onEliminar={setMiembroEliminar}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {m.activo ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="muted">Desactivada</Badge>
                  )}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {m.clientes} cliente(s) a cargo
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Último acceso: {fechaHora(m.ultimo_acceso)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* --- Clientes y responsables -------------------------------------------- */}
      {miembros.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Clientes y responsables</h2>
              <p className="text-sm text-muted-foreground">
                Elegí quién lleva cada monotributista. Cada usuario ve sólo los suyos; vos seguís
                viendo todos.
              </p>
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar cliente…"
                className="pl-9"
              />
            </div>
          </div>

          {cargandoClientes ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando clientes…
            </div>
          ) : (
            <>
              {/* Escritorio: tabla. */}
              <Card className="hidden overflow-hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead className="w-64">A cargo de</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientesFiltrados.map(c => (
                      <TableRow key={c.cuit}>
                        <TableCell className="font-medium">{c.nombre}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {c.cuit}
                        </TableCell>
                        <TableCell>
                          <SelectorResponsable
                            valor={c.responsableId ?? yo?.id ?? 0}
                            opciones={opcionesResponsable}
                            trabajando={asignando === c.cuit}
                            onCambiar={id => void reasignar(c.cuit, id)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {clientesFiltrados.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          No hay clientes que coincidan con la búsqueda.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>

              {/* Mobile: tarjetas. */}
              <div className="space-y-3 lg:hidden">
                {clientesFiltrados.map(c => (
                  <Card key={c.cuit} className="space-y-2 p-4">
                    <div>
                      <div className="font-medium">{c.nombre}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">{c.cuit}</div>
                    </div>
                    <SelectorResponsable
                      valor={c.responsableId ?? yo?.id ?? 0}
                      opciones={opcionesResponsable}
                      trabajando={asignando === c.cuit}
                      onCambiar={id => void reasignar(c.cuit, id)}
                    />
                  </Card>
                ))}
                {clientesFiltrados.length === 0 && (
                  <Card className="p-6 text-center text-sm text-muted-foreground">
                    No hay clientes que coincidan con la búsqueda.
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <DialogAlta
        abierto={dialogAlta}
        onCerrar={() => setDialogAlta(false)}
        onCreado={() => {
          setDialogAlta(false);
          refrescar();
        }}
      />
      <DialogPermisos
        miembro={miembroPermisos}
        onCerrar={() => setMiembroPermisos(null)}
        onGuardado={() => {
          setMiembroPermisos(null);
          refrescar();
        }}
      />
      <DialogPassword
        miembro={miembroPassword}
        onCerrar={() => setMiembroPassword(null)}
        onGuardado={() => setMiembroPassword(null)}
      />
      <DialogEliminar
        miembro={miembroEliminar}
        onCerrar={() => setMiembroEliminar(null)}
        onEliminado={() => {
          setMiembroEliminar(null);
          refrescar();
        }}
      />
    </div>
  );
}

/** Select nativo del responsable de un cliente (estilizado como los inputs del design system). */
function SelectorResponsable({
  valor,
  opciones,
  trabajando,
  onCambiar,
}: {
  valor: number;
  opciones: { id: number; nombre: string }[];
  trabajando: boolean;
  onCambiar: (id: number) => void;
}) {
  return (
    <div className="relative">
      <select
        value={valor}
        disabled={trabajando}
        onChange={e => {
          const id = Number(e.target.value);
          if (id !== valor) onCambiar(id);
        }}
        className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {opciones.map(o => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
      {trabajando && (
        <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
