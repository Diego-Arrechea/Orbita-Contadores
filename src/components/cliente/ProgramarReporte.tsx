import { useMemo, useState } from 'react';
import { CalendarClock, Loader2, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useClientesReales } from '@/lib/queries';
import { cuentaActual, tienePermiso } from '@/lib/cuenta';
import { formatCuit } from '@/lib/utils';
import { editarCliente } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import {
  crearReporteProgramado,
  describirProgramacion,
  DIAS_SEMANA,
  editarReporteProgramado,
  type FrecuenciaEnvio,
  type ProgramacionPayload,
  type ReporteProgramado,
} from '@/services/reportesProgramadosService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CLIENTES = 100;

type Fila = { cuit: string; nombre: string; destino: string; mailGuardado: string };

/** Mañana, 'aaaa-mm-dd' (fecha local). */
function manana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Programa el envío del reporte por mail (pedido de un contador, 8-oct-2026): una vez en una fecha y
 * hora, o repetido (todos los meses o todas las semanas), a uno o varios clientes. A cada cliente le
 * llega SU reporte, a su mail, armado con los datos del día del envío y sus opciones de reporte.
 */
export function ProgramarReporte({
  inicial,
  programacion,
  onCancelar,
  onGuardado,
}: {
  /** Clientes con los que arranca (al programar desde la ficha, el cliente de la ficha). */
  inicial: { cuit: string; nombre: string; emailCliente?: string }[];
  /** Si viene, se edita esa programación. */
  programacion?: ReporteProgramado;
  onCancelar: () => void;
  onGuardado: (p: ReporteProgramado) => void;
}) {
  const cuenta = cuentaActual();
  const { data: cartera } = useClientesReales();
  const [frecuencia, setFrecuencia] = useState<FrecuenciaEnvio>(programacion?.frecuencia ?? 'unica');
  const [fecha, setFecha] = useState(programacion?.fecha ?? manana());
  const [hora, setHora] = useState(programacion?.hora ?? '09:00');
  const [diaMes, setDiaMes] = useState(programacion?.dia_mes ?? 1);
  const [diaSemana, setDiaSemana] = useState(programacion?.dia_semana ?? 0);
  const [mensaje, setMensaje] = useState(programacion?.mensaje ?? '');
  const [copiaAMi, setCopiaAMi] = useState(programacion?.copia_a_mi ?? true);
  const [filas, setFilas] = useState<Fila[]>(() => {
    const mailDe = (cuit: string) => cartera?.find(c => c.cuit === cuit)?.emailCliente ?? '';
    return programacion
      ? programacion.destinos.map(d => ({ cuit: d.cuit, nombre: d.nombre, destino: d.destino, mailGuardado: mailDe(d.cuit) }))
      : inicial.map(c => ({ cuit: c.cuit, nombre: c.nombre, destino: c.emailCliente ?? '', mailGuardado: c.emailCliente ?? '' }));
  });
  const [guardarMails, setGuardarMails] = useState(true);
  const [buscando, setBuscando] = useState(() => !programacion && inicial.length === 0);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegidos = new Set(filas.map(f => f.cuit));
  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    return (cartera ?? [])
      .filter(c => c.fuente === 'arca' && c.activo !== false && !elegidos.has(c.cuit))
      .filter(c => !q || c.nombre.toLowerCase().includes(q) || (qd.length >= 3 && c.cuit.includes(qd)))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartera, busqueda, filas]);

  const agregar = (c: { cuit: string; nombre: string; emailCliente?: string }) =>
    setFilas(prev =>
      prev.length >= MAX_CLIENTES
        ? prev
        : [...prev, { cuit: c.cuit, nombre: c.nombre, destino: c.emailCliente ?? '', mailGuardado: c.emailCliente ?? '' }],
    );
  const quitar = (cuit: string) => setFilas(prev => prev.filter(f => f.cuit !== cuit));
  const setDestino = (cuit: string, destino: string) =>
    setFilas(prev => prev.map(f => (f.cuit === cuit ? { ...f, destino } : f)));

  const mailsOk = filas.length > 0 && filas.every(f => EMAIL_RE.test(f.destino.trim()));
  const mailsNuevos = filas.filter(f => EMAIL_RE.test(f.destino.trim()) && !f.mailGuardado);
  const puedeGuardarMails = mailsNuevos.length > 0 && tienePermiso('editar_cliente');
  const payload: ProgramacionPayload = {
    frecuencia,
    hora,
    fecha: frecuencia === 'unica' ? fecha : null,
    dia_mes: frecuencia === 'mensual' ? diaMes : null,
    dia_semana: frecuencia === 'semanal' ? diaSemana : null,
    destinos: filas.map(f => ({ cuit: f.cuit, destino: f.destino.trim() })),
    mensaje,
    copia_a_mi: copiaAMi,
  };
  const cuandoOk = /^\d{2}:\d{2}$/.test(hora) && (frecuencia !== 'unica' || !!fecha);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const p = programacion
        ? await editarReporteProgramado(programacion.id, payload)
        : await crearReporteProgramado(payload);
      if (puedeGuardarMails && guardarMails) {
        // Best-effort: la programación ya quedó; no guardar un mail no es motivo de error.
        await Promise.allSettled(mailsNuevos.map(f => editarCliente(f.cuit, { emailCliente: f.destino.trim() })));
      }
      onGuardado(p);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Cuándo</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Select value={frecuencia} onValueChange={v => setFrecuencia(v as FrecuenciaEnvio)}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unica">Una vez</SelectItem>
              <SelectItem value="mensual">Todos los meses</SelectItem>
              <SelectItem value="semanal">Todas las semanas</SelectItem>
            </SelectContent>
          </Select>
          {frecuencia === 'unica' && (
            <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="w-[160px]" />
          )}
          {frecuencia === 'mensual' && (
            <Select value={String(diaMes)} onValueChange={v => setDiaMes(Number(v))}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <SelectItem key={d} value={String(d)}>
                    El día {d}
                  </SelectItem>
                ))}
                <SelectItem value="31">El último día</SelectItem>
              </SelectContent>
            </Select>
          )}
          {frecuencia === 'semanal' && (
            <Select value={String(diaSemana)} onValueChange={v => setDiaSemana(Number(v))}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAS_SEMANA.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    Los {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input type="time" value={hora} onChange={e => setHora(e.target.value)} className="w-[110px]" />
        </div>
        {cuandoOk && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {describirProgramacion(payload)} (hora de Argentina). El reporte se arma con los datos del día del envío.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            {filas.length === 1 ? 'Cliente' : `Clientes (${filas.length})`}
          </label>
          {!buscando && filas.length < MAX_CLIENTES && (
            <button
              type="button"
              onClick={() => setBuscando(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Agregar clientes
            </button>
          )}
        </div>
        <div className="mt-1 max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {filas.map(f => {
            const valido = EMAIL_RE.test(f.destino.trim());
            return (
              <div key={f.cuit} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{f.nombre}</div>
                  <Input
                    type="email"
                    value={f.destino}
                    onChange={e => setDestino(f.cuit, e.target.value)}
                    placeholder="mail del cliente"
                    className={`mt-0.5 h-8 text-xs ${f.destino && !valido ? 'border-danger' : ''}`}
                  />
                </div>
                {filas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => quitar(f.cuit)}
                    className="mt-5 shrink-0 text-muted-foreground hover:text-danger"
                    aria-label={`Quitar a ${f.nombre}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {buscando && (
          <div className="mt-2 rounded-lg border border-border/60 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o CUIT"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="mt-1.5 max-h-48 overflow-y-auto">
              {candidatos.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">No hay más clientes que coincidan.</p>
              ) : (
                candidatos.map(c => (
                  <button
                    key={c.cuit}
                    type="button"
                    onClick={() => agregar(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span className="truncate">{c.nombre}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {c.emailCliente ? c.emailCliente : `${formatCuit(c.cuit)} · sin mail`}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="mt-1 text-right">
              <button type="button" onClick={() => setBuscando(false)} className="text-xs text-primary hover:underline">
                Listo
              </button>
            </div>
          </div>
        )}
        {puedeGuardarMails && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={guardarMails}
              onChange={e => setGuardarMails(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            Guardar los mails nuevos en cada cliente
          </label>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Mensaje (opcional, va arriba del reporte de cada cliente)</label>
        <Textarea
          value={mensaje}
          onChange={e => setMensaje(e.target.value)}
          placeholder="Ej.: Te paso cómo venís este mes. Ojo con el tope de la categoría."
          rows={3}
          className="mt-1"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={copiaAMi}
          onChange={e => setCopiaAMi(e.target.checked)}
          className="h-4 w-4 accent-[hsl(var(--primary))]"
        />
        Mandarme una copia de cada mail{cuenta?.email ? ` (${cuenta.email})` : ''}
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={guardando || !mailsOk || !cuandoOk}>
          {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
          {programacion ? 'Guardar cambios' : 'Programar envío'}
        </Button>
      </div>
    </div>
  );
}
