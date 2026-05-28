import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ShieldCheck,
  Eye,
  EyeOff,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCcw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn, formatCuit } from '@/lib/utils';

type Step = 'credentials' | 'detecting' | 'detected';

const PHASES = [
  { label: 'Conectando con ARCA',                durationMs: 700 },
  { label: 'Validando clave fiscal',              durationMs: 600 },
  { label: 'Consultando el padrón',               durationMs: 700 },
  { label: 'Detectando categoría y actividad',    durationMs: 600 },
  { label: 'Sincronizando últimos 13 meses',      durationMs: 600 },
];

const MOCK_DETECTED = {
  nombre: 'Laura Giménez',
  cuit: '27358449123',
  categoria: 'F',
  actividad: 'Servicios',
  fechaInicio: '14 de marzo de 2018',
  domicilio: 'CABA, Palermo',
  estado: 'Monotributista activo',
  cuotaMes: 'Al día',
  ultimaFactura: '10 de mayo de 2026',
};

export function NuevoCliente() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('credentials');
  const [mostrar, setMostrar] = useState(false);
  const [cuit, setCuit] = useState('');
  const [clave, setClave] = useState('');

  const canDetect = cuit.replace(/\D/g, '').length >= 10 && clave.length >= 4;

  const onDetect = () => {
    setStep('detecting');
  };

  const onDetectionDone = () => setStep('detected');

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="-ml-3 mb-3 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Volver
        </Button>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Nuevo cliente</h1>
            <p className="text-base text-muted-foreground mt-2 max-w-xl">
              Cargá la clave fiscal del contribuyente y el sistema detecta automáticamente sus datos
              desde ARCA. Sólo le agregás tus notas al final.
            </p>
          </div>
          {step === 'detected' && (
            <Badge variant="success" className="text-sm gap-1.5 px-3 py-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Datos detectados
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Credentials column */}
        <Card
          className={cn(
            'lg:col-span-2 p-7 transition-colors',
            step === 'detected' && 'border-success/40 bg-success/5',
          )}
        >
          <div className="flex items-start gap-3 mb-5">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl shrink-0 transition-colors',
                step === 'detected'
                  ? 'bg-success/15 text-success'
                  : 'bg-primary/12 text-primary',
              )}
            >
              {step === 'detected' ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-semibold">Credenciales ARCA</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Se guardan cifradas y nunca se vuelven a mostrar en la app. Si el cliente cambia la
                clave, vas a tener que cargarla de nuevo.
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="usuario">Usuario / CUIT</Label>
              <Input
                id="usuario"
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
                placeholder="27358449123"
                disabled={step !== 'credentials'}
                className={step === 'detected' ? 'bg-card' : ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clave">Clave fiscal</Label>
              <div className="relative">
                <Input
                  id="clave"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  type={mostrar ? 'text' : 'password'}
                  placeholder="••••••••"
                  disabled={step !== 'credentials'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setMostrar(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded-md"
                  disabled={step !== 'credentials'}
                >
                  {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {step === 'credentials' && (
            <Button onClick={onDetect} disabled={!canDetect} className="w-full mt-5" size="lg">
              <Sparkles className="h-4 w-4" /> Detectar datos del cliente
            </Button>
          )}

          {step === 'detecting' && (
            <Button disabled className="w-full mt-5" size="lg">
              <Loader2 className="h-4 w-4 animate-spin" /> Conectando con ARCA...
            </Button>
          )}

          {step === 'detected' && (
            <div className="mt-5 rounded-lg bg-success/10 border border-success/25 px-3.5 py-2.5 text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
              <span className="text-success">Conectado correctamente con ARCA</span>
            </div>
          )}
        </Card>

        {/* Preview column */}
        <div className="lg:col-span-3">
          {step === 'credentials' && <PreviewIdle />}
          {step === 'detecting' && <PreviewDetecting onDone={onDetectionDone} />}
          {step === 'detected' && <PreviewDetected />}
        </div>
      </div>

      {step === 'detected' && (
        <Card className="p-7">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold">Notas internas</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Sólo las ve el contador. El cliente nunca tiene acceso a este campo.
              </div>
            </div>
          </div>
          <Textarea
            placeholder="Anotaciones que querés tener a mano cuando revises este cliente: estacionalidad, cuándo te manda extractos, contexto personal, etc."
            rows={4}
          />
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button onClick={() => navigate('/')} size="lg">
              <CheckCircle2 className="h-4 w-4" /> Agregar cliente a la cartera
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ─────────────── Preview idle (skeleton) ─────────────── */

function PreviewIdle() {
  const fields = [
    { label: 'Razón social / nombre', hint: 'Desde el padrón de ARCA' },
    { label: 'CUIT', hint: 'Confirmación del CUIT cargado' },
    { label: 'Categoría actual', hint: 'A hasta K, según ingresos' },
    { label: 'Tipo de actividad', hint: 'Comercio o servicios' },
    { label: 'Fecha de inicio', hint: 'Inicio formal de actividades' },
    { label: 'Estado de la cuota', hint: 'Al día o con deuda del mes corriente' },
  ];

  return (
    <Card className="p-7 h-full border-dashed">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-xs uppercase tracking-wider text-primary font-semibold">
          Se completa automáticamente
        </span>
      </div>
      <div className="font-semibold mb-1">Datos que vamos a detectar</div>
      <p className="text-sm text-muted-foreground mb-5 max-w-md">
        Una vez que ingreses la clave fiscal, consultamos el padrón de ARCA y traemos todo esto sin
        que tengas que tipear nada.
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {fields.map(f => (
          <div key={f.label} className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              {f.label}
            </div>
            <div className="h-4 w-24 mt-1.5 rounded bg-muted-foreground/15" />
            <div className="text-[11px] text-muted-foreground/80 mt-1.5">{f.hint}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────── Preview detecting (animation) ─────────────── */

function PreviewDetecting({ onDone }: { onDone: () => void }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let elapsed = 0;
    const totalMs = PHASES.reduce((s, p) => s + p.durationMs, 0);

    const advance = (i: number) => {
      if (cancelled) return;
      setPhaseIdx(i);
      if (i >= PHASES.length) {
        setProgress(100);
        setTimeout(() => !cancelled && onDone(), 250);
        return;
      }
      const phase = PHASES[i];
      const start = Date.now();
      const baseProgress = (elapsed / totalMs) * 100;
      const phaseShare = (phase.durationMs / totalMs) * 100;
      const tickIntervalId = setInterval(() => {
        if (cancelled) {
          clearInterval(tickIntervalId);
          return;
        }
        const t = Math.min(1, (Date.now() - start) / phase.durationMs);
        setProgress(baseProgress + phaseShare * t);
        if (t >= 1) {
          clearInterval(tickIntervalId);
          elapsed += phase.durationMs;
          advance(i + 1);
        }
      }, 30);
    };

    advance(0);
    return () => {
      cancelled = true;
    };
  }, [onDone]);

  return (
    <Card className="p-7 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
        <span className="text-xs uppercase tracking-wider text-primary font-semibold">
          Consultando ARCA
        </span>
      </div>

      <div className="mb-5">
        <Progress value={progress} className="h-1.5" />
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">
          {Math.round(progress)}%
        </div>
      </div>

      <ul className="space-y-2">
        {PHASES.map((p, i) => (
          <li
            key={p.label}
            className={cn(
              'flex items-center gap-2.5 text-sm transition-all',
              i < phaseIdx && 'text-success',
              i === phaseIdx && 'text-foreground font-medium',
              i > phaseIdx && 'text-muted-foreground/50',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {i < phaseIdx ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : i === phaseIdx ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─────────────── Preview detected ─────────────── */

function PreviewDetected() {
  return (
    <Card className="p-7 h-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs uppercase tracking-wider text-primary font-semibold">
              Datos detectados desde ARCA
            </span>
          </div>
          <div className="font-semibold text-lg tracking-tight mt-1">{MOCK_DETECTED.nombre}</div>
          <div className="text-sm text-muted-foreground tabular-nums">
            CUIT {formatCuit(MOCK_DETECTED.cuit)}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <RefreshCcw className="h-3.5 w-3.5" /> Re-sincronizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <DetectedField label="Categoría actual">
          <Badge variant="outline" className="font-semibold">
            Cat. {MOCK_DETECTED.categoria}
          </Badge>
        </DetectedField>
        <DetectedField label="Tipo de actividad">
          <span className="text-sm font-medium">{MOCK_DETECTED.actividad}</span>
        </DetectedField>
        <DetectedField label="Fecha de inicio">
          <span className="text-sm font-medium">{MOCK_DETECTED.fechaInicio}</span>
        </DetectedField>
        <DetectedField label="Domicilio fiscal">
          <span className="text-sm font-medium">{MOCK_DETECTED.domicilio}</span>
        </DetectedField>
        <DetectedField label="Estado en el régimen">
          <Badge variant="success">{MOCK_DETECTED.estado}</Badge>
        </DetectedField>
        <DetectedField label="Cuota del mes">
          <Badge variant="success">{MOCK_DETECTED.cuotaMes}</Badge>
        </DetectedField>
      </div>

      <div className="mt-5 rounded-lg bg-primary/8 border border-primary/15 px-3.5 py-2.5 text-sm flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-primary shrink-0" />
        <span className="text-foreground/80">
          Última factura emitida: <strong>{MOCK_DETECTED.ultimaFactura}</strong>. Vamos a
          sincronizar los últimos 13 meses al guardar el cliente.
        </span>
      </div>
    </Card>
  );
}

function DetectedField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3.5 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
