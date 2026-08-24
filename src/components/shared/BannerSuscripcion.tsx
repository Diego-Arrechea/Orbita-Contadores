/**
 * Aviso de vencimiento de la suscripción, arriba del dashboard.
 *
 * La suscripción vive escondida en Configuración (es administración, no trabajo del día), así que
 * nadie va a entrar a mirar si venció: el aviso tiene que salir a buscar al contador donde ya está.
 * Aparece sólo cuando hay algo que hacer —el vencimiento está cerca o ya pasó— y lleva directo a la
 * pestaña. El resto del tiempo no ocupa lugar.
 *
 * Mismo alcance que la pestaña: las cuentas plenas. Los usuarios del estudio no lo ven — la
 * suscripción es del titular, y el backend les responde 403.
 *
 * Vencer NO corta el servicio hoy, así que la copy avisa y ofrece regularizar; nunca amenaza con
 * cortar nada.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { esEmpleado } from '@/lib/cuenta';
import { formatDate } from '@/lib/utils';
import { obtenerMiSuscripcion, type MiSuscripcion } from '@/services/suscripcionService';

/** Cuántos días antes del vencimiento empieza a avisar. */
const DIAS_AVISO = 10;

const LS_OCULTO = 'orbita_aviso_suscripcion';
const hoyISO = () => new Date().toISOString().slice(0, 10);

/** El aviso "por vencer" se puede posponer hasta mañana; el de vencido no. */
function pospuestoHoy(): boolean {
  try {
    return localStorage.getItem(LS_OCULTO) === hoyISO();
  } catch {
    return false;
  }
}

function posponerHastaMañana(): void {
  try {
    localStorage.setItem(LS_OCULTO, hoyISO());
  } catch {
    /* sin localStorage: el aviso vuelve a aparecer, no es grave */
  }
}

type Aviso = { tono: 'danger' | 'warning'; titulo: string; detalle: string };

/** Qué avisar, si es que hay algo que avisar. */
function avisoDe(s: MiSuscripcion): Aviso | null {
  const dias = s.dias_restantes;
  if (s.estado === 'sin_cargo' || s.estado === 'cancelada') return null;

  if (s.estado === 'vencida' || (dias !== null && dias !== undefined && dias < 0)) {
    return {
      tono: 'danger',
      titulo: s.vence
        ? `Tu suscripción venció el ${formatDate(s.vence)}`
        : 'Tenés un período pendiente de pago',
      detalle: 'Escribinos y lo regularizamos en el día.',
    };
  }

  if (dias === null || dias === undefined || dias > DIAS_AVISO || !s.vence) return null;

  const cuando =
    dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días (${formatDate(s.vence)})`;
  return {
    tono: 'warning',
    titulo:
      s.estado === 'prueba'
        ? `Tu período de prueba termina ${cuando}`
        : `Tu suscripción se renueva ${cuando}`,
    detalle: 'Si querés cambiar de plan o revisar la facturación, entrá a tu suscripción.',
  };
}

export function BannerSuscripcion() {
  const habilitado = !esEmpleado();
  const { data: sus } = useQuery({
    queryKey: ['suscripcion'],
    queryFn: obtenerMiSuscripcion,
    enabled: habilitado,
  });
  const [pospuesto, setPospuesto] = useState(pospuestoHoy);

  if (!habilitado || !sus) return null;
  const aviso = avisoDe(sus);
  if (!aviso) return null;

  const esUrgente = aviso.tono === 'danger';
  if (!esUrgente && pospuesto) return null;

  const Icono = esUrgente ? AlertTriangle : CalendarClock;

  return (
    <div
      className={
        'rounded-xl border px-4 py-3.5 ' +
        (esUrgente ? 'border-danger/40 bg-danger/10' : 'border-warning/40 bg-warning/10')
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full ' +
            (esUrgente ? 'bg-danger/15 text-danger' : 'bg-warning/20 text-warning-foreground')
          }
        >
          <Icono className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className={'font-semibold ' + (esUrgente ? 'text-danger' : 'text-warning-foreground')}>
            {aviso.titulo}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{aviso.detalle}</p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to="/configuracion?tab=suscripcion">
              Ver mi suscripción <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* El aviso de "por vencer" se puede posponer hasta mañana; el de vencido se queda. */}
        {!esUrgente && (
          <button
            type="button"
            aria-label="Recordármelo mañana"
            title="Recordármelo mañana"
            onClick={() => {
              posponerHastaMañana();
              setPospuesto(true);
            }}
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-warning/20 hover:text-warning-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
