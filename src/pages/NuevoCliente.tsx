import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ShieldCheck,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  Circle,
  KeyRound,
  AlertCircle,
  XCircle,
  Users,
  Upload,
  FileUp,
  FileCheck2,
  ArrowRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn, formatCuit } from '@/lib/utils';
import {
  listarRepresentados,
  iniciarMonitoreo,
  subirCert,
  type Representado,
  type JobProgreso,
} from '@/services/onboardingService';
import { useCargas } from '@/context/CargasContext';
import { useClientesReales } from '@/lib/queries';
import { usuarioActual } from '@/lib/cuenta';

type Paso = 'credenciales' | 'listando' | 'elegir' | 'monitoreando';

export function NuevoCliente() {
  const navigate = useNavigate();
  const [paso, setPaso] = useState<Paso>('credenciales');
  const [metodo, setMetodo] = useState<'auto' | 'subir'>('auto');
  const [cuit, setCuit] = useState('');
  const [clave, setClave] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [representados, setRepresentados] = useState<Representado[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const { cargas, registrarCarga } = useCargas();
  // El progreso se lee del contexto global: así sigue corriendo aunque el contador navegue.
  const progreso = jobId ? cargas.find(c => c.jobId === jobId) ?? null : null;

  // Sugerencias del campo CUIT: SOLO CUITs (el del contador + los que ya usó), nunca emails/cuentas.
  // El navegador, por su cuenta, ofrecía el email de login y las cuentas guardadas: lo desactivamos
  // con autoComplete y damos esta lista propia.
  const { data: clientes = [] } = useClientesReales();
  const cuitsSugeridos = useMemo(() => {
    const todos = [usuarioActual()?.cuit, ...clientes.map(c => c.cuit)]
      .map(c => (c ?? '').replace(/\D/g, ''))
      .filter(c => c.length === 11);
    return [...new Set(todos)];
  }, [clientes]);

  // CUITs que el contador YA tiene en su cartera: no se pueden volver a sumar.
  const cuitsEnCartera = useMemo(
    () => new Set(clientes.map(c => (c.cuit ?? '').replace(/\D/g, ''))),
    [clientes],
  );
  const yaEnCartera = (c: string) => cuitsEnCartera.has(c.replace(/\D/g, ''));

  const puedeConectar = cuit.replace(/\D/g, '').length >= 10 && clave.length >= 4;
  const elegidos = representados.filter(r => seleccionados.has(r.cuit));

  const conectar = async () => {
    setPaso('listando');
    setError(null);
    try {
      const reps = await listarRepresentados(cuit.replace(/\D/g, ''), clave);
      setRepresentados(reps);
      // Autoseleccionamos sólo si hay uno solo y todavía no está en la cartera.
      setSeleccionados(
        reps.length === 1 && !yaEnCartera(reps[0].cuit) ? new Set([reps[0].cuit]) : new Set(),
      );
      setPaso('elegir');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaso('credenciales');
    }
  };

  const toggle = (c: string) => {
    if (yaEnCartera(c)) return; // ya está en la cartera: no se puede sumar de nuevo
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const monitorear = async () => {
    setPaso('monitoreando');
    setError(null);
    try {
      const { job_id } = await iniciarMonitoreo(cuit.replace(/\D/g, ''), clave, elegidos);
      setJobId(job_id);
      // A partir de acá la carga la sigue el contexto global (sobrevive a la navegación).
      registrarCarga(job_id, elegidos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaso('elegir');
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="-ml-3 mb-3 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">Nuevo cliente</h1>
        <p className="text-base text-muted-foreground mt-2 max-w-xl">
          Ingresá la clave fiscal una sola vez. Leemos de ARCA los CUITs que representa y elegís a
          cuáles querés monitorear.
        </p>
      </div>

      {/* Método: generar el cert con la clave fiscal, o subir uno ya emitido */}
      {paso === 'credenciales' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMetodo('auto')}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition-colors',
              metodo === 'auto' ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/40',
            )}
          >
            <KeyRound
              className={cn('h-5 w-5 shrink-0', metodo === 'auto' ? 'text-primary' : 'text-muted-foreground/50')}
            />
            <div>
              <div className="text-sm font-medium">Generar con clave fiscal</div>
              <div className="text-xs text-muted-foreground">Lo creamos en ARCA por vos</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMetodo('subir')}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition-colors',
              metodo === 'subir' ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/40',
            )}
          >
            <Upload
              className={cn('h-5 w-5 shrink-0', metodo === 'subir' ? 'text-primary' : 'text-muted-foreground/50')}
            />
            <div>
              <div className="text-sm font-medium">Ya tengo el certificado</div>
              <div className="text-xs text-muted-foreground">Subí el .crt + la .key</div>
            </div>
          </button>
        </div>
      )}

      {metodo === 'subir' && <SubirCertForm onListo={() => navigate('/')} />}

      {/* PASO 1 — credenciales del contador */}
      {metodo === 'auto' && (paso === 'credenciales' || paso === 'listando') && (
        <Card className="p-7">
          <div className="flex items-start gap-3 mb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">Tu clave fiscal</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Se usa para leer tus representados y traer sus comprobantes. Se guarda cifrada
                para la sincronización diaria automática.
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cuit">CUIT</Label>
              <Input
                id="cuit"
                name="cuit-arca"
                value={cuit}
                onChange={e => setCuit(e.target.value)}
                placeholder="Tu CUIT (sin guiones)"
                disabled={paso === 'listando'}
                inputMode="numeric"
                autoComplete="off"
                list="orbita-cuits"
              />
              <datalist id="orbita-cuits">
                {cuitsSugeridos.map(c => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clave">Clave fiscal</Label>
              <div className="relative">
                <Input
                  id="clave"
                  name="clave-arca"
                  value={clave}
                  onChange={e => setClave(e.target.value)}
                  type={mostrar ? 'text' : 'password'}
                  placeholder="••••••••"
                  disabled={paso === 'listando'}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setMostrar(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded-md"
                  disabled={paso === 'listando'}
                >
                  {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-danger/10 border border-danger/25 px-3.5 py-2.5 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <span className="text-foreground/80">{error}</span>
            </div>
          )}

          {paso === 'credenciales' ? (
            <Button onClick={conectar} disabled={!puedeConectar} className="w-full mt-5" size="lg">
              <KeyRound className="h-4 w-4" /> Conectar y leer mis representados
            </Button>
          ) : (
            <Button disabled className="w-full mt-5" size="lg">
              <Loader2 className="h-4 w-4 animate-spin" /> Conectando con ARCA…
            </Button>
          )}
        </Card>
      )}

      {/* PASO 2 — elegir a quién monitorear */}
      {paso === 'elegir' && (
        <Card className="p-7">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-xs uppercase tracking-wider text-primary font-semibold">
              {representados.length} {representados.length === 1 ? 'CUIT disponible' : 'CUITs disponibles'}
            </span>
          </div>
          <div className="font-semibold mb-4">Elegí a quién monitorear</div>

          <div className="space-y-2">
            {representados.map(r => {
              const enCartera = yaEnCartera(r.cuit);
              const sel = seleccionados.has(r.cuit);
              return (
                <button
                  key={r.cuit}
                  type="button"
                  onClick={() => toggle(r.cuit)}
                  disabled={enCartera}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                    enCartera
                      ? 'border-border/40 bg-muted/30 cursor-not-allowed'
                      : sel
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 hover:bg-muted/40',
                  )}
                >
                  {enCartera ? (
                    <CheckCircle2 className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                  ) : sel ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div
                      className={cn(
                        'text-sm font-medium truncate',
                        enCartera && 'text-muted-foreground',
                      )}
                    >
                      {r.nombre}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      CUIT {formatCuit(r.cuit)}
                    </div>
                  </div>
                  {enCartera && (
                    <Badge variant="muted" className="ml-auto shrink-0 text-[10px]">
                      Ya en tu cartera
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => setPaso('credenciales')}>
              Volver
            </Button>
            <Button size="lg" disabled={elegidos.length === 0} onClick={monitorear}>
              <CheckCircle2 className="h-4 w-4" /> Monitorear{elegidos.length > 0 ? ` (${elegidos.length})` : ''}
            </Button>
          </div>
        </Card>
      )}

      {/* PASO 3 — monitoreando (bootstrap del cert con barra) */}
      {paso === 'monitoreando' && (
        <Card className="p-7">
          {progreso?.estado === 'terminado' ? (
            <ResultadoFinal progreso={progreso} onDashboard={() => navigate('/')} />
          ) : progreso?.estado === 'error' ? (
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">No se pudo completar</div>
                <div className="text-sm text-muted-foreground mt-1">{progreso.error}</div>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setPaso('elegir')}>
                  Volver
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <span className="text-xs uppercase tracking-wider text-primary font-semibold">
                  Trayendo comprobantes de ARCA
                </span>
              </div>
              <Progress value={progreso?.progreso ?? 0} className="h-2" />
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-foreground/80">{progreso?.mensaje ?? 'Iniciando…'}</span>
                <span className="text-muted-foreground tabular-nums">{progreso?.progreso ?? 0}%</span>
              </div>
              <div className="mt-5 rounded-lg bg-primary/8 border border-primary/15 px-3.5 py-2.5 text-xs text-muted-foreground">
                La carga sigue en segundo plano. Podés volver al dashboard y seguir trabajando —
                vas a ver el avance arriba, al lado de las notificaciones.
              </div>
              <div className="flex justify-end mt-4">
                <Button onClick={() => navigate('/')}>
                  Volver al dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function ResultadoFinal({
  progreso,
  onDashboard,
}: {
  progreso: JobProgreso;
  onDashboard: () => void;
}) {
  const ok = progreso.resultados.filter(r => r.ok);
  const fallaron = progreso.resultados.filter(r => !r.ok);
  return (
    <div>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/15 text-success shrink-0">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold">
            {ok.length} {ok.length === 1 ? 'cliente conectado' : 'clientes conectados'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Ya están en tu cartera con sus comprobantes sincronizados.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {progreso.resultados.map(r => (
          <div key={r.cuit} className="rounded-xl border border-border/60 bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              {r.ok ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-danger shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.nombre}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  CUIT {formatCuit(r.cuit)}
                </div>
              </div>
              {!r.ok && <Badge variant="muted" className="text-[10px]">falló</Badge>}
            </div>
            {!r.ok && r.error && (
              <div className="mt-2 text-[11px] text-danger/90 bg-danger/5 border border-danger/15 rounded-md px-2.5 py-2 break-words leading-relaxed">
                {r.error}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-6">
        <Button size="lg" onClick={onDashboard}>
          Ir al dashboard
        </Button>
      </div>
    </div>
  );
}

type Archivo = { name: string; pem: string };

function SubirCertForm({ onListo }: { onListo: () => void }) {
  const [cuit, setCuit] = useState('');
  const [nombre, setNombre] = useState('');
  const [cert, setCert] = useState<Archivo | null>(null);
  const [clave, setClave] = useState<Archivo | null>(null);
  const [estado, setEstado] = useState<'idle' | 'subiendo' | 'ok' | 'error'>('idle');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [advertencia, setAdvertencia] = useState<string | null>(null);

  const leer = (file: File | undefined, set: (v: Archivo) => void) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ name: file.name, pem: String(reader.result || '') });
    reader.readAsText(file);
  };

  const puede = cuit.replace(/\D/g, '').length >= 10 && nombre.trim().length > 0 && !!cert && !!clave;

  const subir = async () => {
    if (!cert || !clave) return;
    setEstado('subiendo');
    setMensaje(null);
    setAdvertencia(null);
    try {
      const r = await subirCert(cuit.replace(/\D/g, ''), nombre.trim(), cert.pem, clave.pem);
      setAdvertencia(r.advertencia);
      setMensaje(`Se sincronizaron ${r.sincronizados} comprobantes.`);
      setEstado('ok');
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : String(e));
      setEstado('error');
    }
  };

  if (estado === 'ok') {
    return (
      <Card className="p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/15 text-success shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold">{nombre} conectado</div>
            <div className="text-sm text-muted-foreground mt-0.5">{mensaje}</div>
            {advertencia && (
              <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs text-foreground/80 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span className="break-words">{advertencia}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <Button size="lg" onClick={onListo}>
            Ir al dashboard
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-7">
      <div className="flex items-start gap-3 mb-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
          <Upload className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold">Subí el certificado del cliente</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Hacen falta los dos archivos: el certificado (<b>.crt</b>) y su clave privada (<b>.key</b>).
            La <b>.key</b> es la que se generó junto con el certificado — no se puede sacar del .crt.
            Se guardan cifrados.
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cuit-c">CUIT del cliente</Label>
            <Input
              id="cuit-c"
              name="cuit-cliente"
              value={cuit}
              onChange={e => setCuit(e.target.value)}
              placeholder="Sin guiones"
              inputMode="numeric"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nombre-c">Nombre / Razón social</Label>
            <Input
              id="nombre-c"
              name="nombre-cliente"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej. Juan Pérez"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FileField label="Certificado (.crt)" accept=".crt,.pem,.cer" file={cert} onPick={f => leer(f, setCert)} />
          <FileField label="Clave privada (.key)" accept=".key,.pem" file={clave} onPick={f => leer(f, setClave)} />
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-muted/50 border border-border/60 px-3.5 py-2.5 text-xs text-muted-foreground flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          ¿No tenés la <b>.key</b>? No se puede generar desde el .crt. Usá{' '}
          <b>“Generar con clave fiscal”</b> (arriba) — Órbita crea el certificado y su clave por vos,
          sin manejar archivos.
        </span>
      </div>

      {estado === 'error' && mensaje && (
        <div className="mt-4 rounded-lg bg-danger/10 border border-danger/25 px-3.5 py-2.5 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <span className="text-foreground/80 break-words">{mensaje}</span>
        </div>
      )}

      <Button onClick={subir} disabled={!puede || estado === 'subiendo'} className="w-full mt-5" size="lg">
        {estado === 'subiendo' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Subiendo y sincronizando…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" /> Subir y conectar
          </>
        )}
      </Button>
    </Card>
  );
}

function FileField({
  label,
  accept,
  file,
  onPick,
}: {
  label: string;
  accept: string;
  file: Archivo | null;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <label
        className={cn(
          'flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm cursor-pointer transition-colors',
          file
            ? 'border-success/40 bg-success/5 text-foreground'
            : 'border-border/70 hover:bg-muted/40 text-muted-foreground',
        )}
      >
        {file ? (
          <FileCheck2 className="h-4 w-4 text-success shrink-0" />
        ) : (
          <FileUp className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{file ? file.name : 'Elegir archivo…'}</span>
        <input type="file" accept={accept} className="hidden" onChange={e => onPick(e.target.files?.[0])} />
      </label>
    </div>
  );
}
