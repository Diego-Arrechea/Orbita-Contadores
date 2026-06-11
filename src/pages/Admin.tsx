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
  ArrowLeft,
  Receipt,
  ChevronRight,
  Cpu,
  Clock,
  Zap,
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
  listarTodosLosClientes,
  obtenerFichaContador,
  obtenerEstadoMotor,
  type AdminUsuario,
  type AdminMetricas,
  type AdminAuditoria,
  type AdminSyncFallida,
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
          <TabsTrigger value="clientes">
            <Building2 className="h-4 w-4" /> Clientes
          </TabsTrigger>
          <TabsTrigger value="motor">
            <Cpu className="h-4 w-4" /> Motor
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

// --- Tab: Cuentas ---

function TabCuentas({ miId, onImpersonar }: { miId?: number; onImpersonar: () => void }) {
  const [usuarios, setUsuarios] = useState<AdminUsuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [accionando, setAccionando] = useState<number | null>(null);
  const [fichaId, setFichaId] = useState<number | null>(null);

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

// --- Tab: Motor de sincronización ---

function haceTexto(h?: number | null): string {
  if (h == null) return 'nunca';
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 48) return `hace ${h.toFixed(1)} h`;
  return `hace ${Math.round(h / 24)} d`;
}

function ClientesTabla({
  filas,
  modo,
}: {
  filas: MotorCliente[];
  modo: 'cola' | 'actividad';
}) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Contador</TableHead>
            {modo === 'actividad' ? (
              <>
                <TableHead className="text-center">Resultado</TableHead>
                <TableHead className="text-right">Comprob.</TableHead>
                <TableHead className="text-right">Cuándo</TableHead>
              </>
            ) : (
              <TableHead className="text-right">Última sync</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.map((f, i) => (
            <TableRow key={`${f.cuit}-${i}`}>
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
              <TableCell colSpan={modo === 'actividad' ? 5 : 3} className="text-center text-muted-foreground py-8">
                {modo === 'cola' ? 'No hay clientes pendientes: está todo al día. 🎉' : 'Sin actividad reciente.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function TabMotor() {
  const [m, setM] = useState<MotorEstado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  async function cargar() {
    try {
      setM(await obtenerEstadoMotor());
      setError('');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 8000); // se refresca solo para sentirse "en vivo"
    return () => clearInterval(t);
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando estado del motor…
      </div>
    );
  }
  if (error || !m) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-sm">
        <AlertCircle className="h-4 w-4" /> {error || 'No se pudo cargar el motor.'}
      </div>
    );
  }

  const exito = m.syncs_24h ? Math.round((m.exitosas_24h / m.syncs_24h) * 100) : null;

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricaCard icon={Zap} label="Syncs última hora" valor={m.syncs_1h} />
          <MetricaCard icon={Activity} label="Syncs últimas 24h" valor={m.syncs_24h} />
          <MetricaCard
            icon={CheckCircle2}
            label="Tasa de éxito 24h"
            valor={exito == null ? '—' : `${exito}%`}
            hint={`${m.exitosas_24h} ok · ${m.fallidas_24h} con falla`}
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
          <ClientesTabla filas={m.actividad} modo="actividad" />
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
  const [clientes, setClientes] = useState<AdminCliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [busqueda, setBusqueda] = useState('');

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      setClientes(await listarTodosLosClientes());
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
    if (!q) return clientes;
    return clientes.filter(c =>
      [c.nombre, c.cuit, c.contador_email, c.contador_nombre, c.categoria].some(x =>
        (x ?? '').toLowerCase().includes(q)
      )
    );
  }, [clientes, busqueda]);

  const totalFacturado = useMemo(
    () => filtrados.reduce((s, c) => s + facturado12m(c), 0),
    [filtrados]
  );

  if (cargando) {
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
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <RefreshCcw className="h-4 w-4" /> Actualizar
        </Button>
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
  return (
    <Card className="overflow-hidden">
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
                {c.cuota_estado === 'al-dia' ? (
                  <Badge variant="success">al día</Badge>
                ) : c.cuota_estado === 'con-deuda' ? (
                  <Badge variant="warning">con deuda</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-sm">
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
  const [ficha, setFicha] = useState<AdminContadorFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [accionando, setAccionando] = useState(false);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        setFicha(await obtenerFichaContador(id));
      } catch (e) {
        setError(mensajeDeError(e));
      } finally {
        setCargando(false);
      }
    })();
  }, [id]);

  async function entrarComo() {
    setAccionando(true);
    setError('');
    try {
      const auth = await impersonar(id);
      iniciarImpersonacion(auth);
      onImpersonar();
    } catch (e) {
      setError(mensajeDeError(e));
      setAccionando(false);
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando ficha…
      </div>
    );
  }
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
