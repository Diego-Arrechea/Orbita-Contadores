import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
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
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  listarUsuarios,
  obtenerMetricas,
  editarUsuario,
  impersonar,
  listarAuditoria,
  listarSincronizacionesFallidas,
  reintentarSync,
  estadoSync,
  type AdminUsuario,
  type AdminMetricas,
  type AdminAuditoria,
  type AdminSyncFallida,
} from '@/services/adminService';
import { mensajeDeError } from '@/services/authService';
import { iniciarImpersonacion, usuarioActual } from '@/lib/cuenta';

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
        <TabsList>
          <TabsTrigger value="cuentas">
            <Users className="h-4 w-4" /> Cuentas
          </TabsTrigger>
          <TabsTrigger value="metricas">
            <Activity className="h-4 w-4" /> Métricas
          </TabsTrigger>
          <TabsTrigger value="auditoria">
            <ShieldCheck className="h-4 w-4" /> Auditoría
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cuentas">
          <TabCuentas miId={yo?.id} onImpersonar={() => navigate('/')} />
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

// --- Tab: Cuentas ---

function TabCuentas({ miId, onImpersonar }: { miId?: number; onImpersonar: () => void }) {
  const [usuarios, setUsuarios] = useState<AdminUsuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [accionando, setAccionando] = useState<number | null>(null);

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      setUsuarios(await listarUsuarios());
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter(u =>
      [u.nombre, u.apellido, u.email, u.estudio, u.cuit].some(c =>
        (c ?? '').toLowerCase().includes(q)
      )
    );
  }, [usuarios, busqueda]);

  async function toggleActivo(u: AdminUsuario) {
    setAccionando(u.id);
    setError('');
    try {
      const actualizado = await editarUsuario(u.id, { activo: !u.activo });
      setUsuarios(prev => prev.map(x => (x.id === u.id ? actualizado : x)));
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setAccionando(null);
    }
  }

  async function entrarComo(u: AdminUsuario) {
    setAccionando(u.id);
    setError('');
    try {
      const auth = await impersonar(u.id);
      iniciarImpersonacion(auth);
      onImpersonar();
    } catch (e) {
      setError(mensajeDeError(e));
      setAccionando(null);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando cuentas…
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
            placeholder="Buscar por nombre, email, estudio o CUIT…"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <RefreshCcw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contador</TableHead>
              <TableHead>Estudio</TableHead>
              <TableHead className="text-center">Clientes</TableHead>
              <TableHead>Alta</TableHead>
              <TableHead>Último acceso</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map(u => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium flex items-center gap-2">
                    {u.nombre} {u.apellido}
                    {u.rol === 'admin' && (
                      <Badge variant="default" className="text-[10px]">
                        <ShieldCheck className="h-3 w-3" /> admin
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell className="text-sm">{u.estudio || '—'}</TableCell>
                <TableCell className="text-center tabular-nums">{u.clientes}</TableCell>
                <TableCell className="text-sm">{fechaCorta(u.creado_en)}</TableCell>
                <TableCell className="text-sm">{fechaHora(u.ultimo_acceso)}</TableCell>
                <TableCell className="text-center">
                  {u.activo ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="muted">Inhabilitada</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={accionando === u.id || !u.activo || u.id === miId}
                      onClick={() => void entrarComo(u)}
                      title={u.id === miId ? 'Es tu propia cuenta' : 'Entrar como este contador'}
                    >
                      <LogIn className="h-4 w-4" /> Entrar como
                    </Button>
                    <Button
                      variant={u.activo ? 'destructive' : 'default'}
                      size="sm"
                      disabled={accionando === u.id || u.id === miId}
                      onClick={() => void toggleActivo(u)}
                      title={u.id === miId ? 'No podés desactivar tu cuenta' : ''}
                    >
                      {accionando === u.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  No hay cuentas que coincidan con la búsqueda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
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
  const [m, setM] = useState<AdminMetricas | null>(null);
  const [fallidas, setFallidas] = useState<AdminSyncFallida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    try {
      const [met, fall] = await Promise.all([
        obtenerMetricas(),
        listarSincronizacionesFallidas(),
      ]);
      setM(met);
      setFallidas(fall);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando métricas…
      </div>
    );
  }
  if (error || !m) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {error || 'No se pudieron cargar las métricas.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricaCard icon={Users} label="Cuentas totales" valor={m.total_cuentas} />
        <MetricaCard icon={UserCheck} label="Cuentas activas" valor={m.cuentas_activas} />
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

      <SyncsFallidas fallidas={fallidas} onCambio={cargar} />
    </div>
  );
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Log de sincronizaciones con problemas (vista de ops: motivo técnico + estado actual + reintento).
function SyncsFallidas({
  fallidas,
  onCambio,
}: {
  fallidas: AdminSyncFallida[];
  onCambio: () => Promise<void> | void;
}) {
  // Estado de reintento por cuit: 'corriendo' mientras poolea el job; mensaje de error si falló.
  const [reintentando, setReintentando] = useState<Record<string, boolean>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});

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
      await onCambio(); // refresca lista + métricas (la fila puede pasar a "Resuelto")
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
        <h2 className="text-sm font-semibold">Sincronizaciones con problemas</h2>
        <Badge variant={fallidas.length ? 'warning' : 'muted'}>{fallidas.length}</Badge>
      </div>

      {fallidas.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No hay sincronizaciones con problemas recientes. 🎉
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Contador</TableHead>
                <TableHead className="text-center">Estado actual</TableHead>
                <TableHead>Detalle del problema</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fallidas.map((f, i) => {
                const corriendo = reintentando[f.cuit];
                const err = errores[f.cuit];
                return (
                  <TableRow key={`${f.cuit}-${f.fecha}-${i}`}>
                    <TableCell className="text-sm whitespace-nowrap">{fechaHora(f.fecha)}</TableCell>
                    <TableCell className="text-sm">
                      <div>{f.cliente || '—'}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{f.cuit}</div>
                    </TableCell>
                    <TableCell className="text-sm">{f.contador_email || '—'}</TableCell>
                    <TableCell className="text-center">
                      {f.resuelto ? (
                        <Badge variant="success" title={`Sincronizado después: ${fechaHora(f.ultima_sync_ok)}`}>
                          <CheckCircle2 className="h-3 w-3" /> Resuelto
                        </Badge>
                      ) : (
                        <Badge variant="danger">Sin resolver</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <code
                        className="block max-w-sm truncate font-mono text-xs text-danger"
                        title={f.motivo || ''}
                      >
                        {(f.motivo || '—').split('\n')[0]}
                      </code>
                      {err && <div className="text-xs text-danger mt-1">{err}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.resuelto ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={corriendo}
                          onClick={() => void reintentar(f.cuit)}
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
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// --- Tab: Auditoría ---

const ACCION_LABEL: Record<string, { texto: string; variant: 'success' | 'danger' | 'warning' | 'muted' }> = {
  activar: { texto: 'Activó', variant: 'success' },
  desactivar: { texto: 'Desactivó', variant: 'danger' },
  cambiar_rol: { texto: 'Cambió rol', variant: 'warning' },
  impersonar: { texto: 'Entró como', variant: 'muted' },
};

function TabAuditoria() {
  const [filas, setFilas] = useState<AdminAuditoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setFilas(await listarAuditoria());
      } catch (e) {
        setError(mensajeDeError(e));
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando auditoría…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {error}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
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
  );
}
