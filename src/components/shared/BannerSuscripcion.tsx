/**
 * Aviso de vencimiento de la suscripción, arriba del dashboard.
 *
 * La suscripción vive escondida en Configuración (es administración, no trabajo del día), así que
 * nadie va a entrar a mirar si venció: el aviso tiene que salir a buscar al contador donde ya está.
 * Aparece sólo cuando hay algo que hacer —el vencimiento está cerca o ya pasó— y el resto del
 * tiempo no ocupa lugar.
 *
 * Lo ve cualquier CUENTA PLENA, no sólo el equipo de Órbita: vencer apaga secciones (facturación,
 * equipo, IVA, contabilidad), así que el contador tiene que enterarse antes de que le pase. Para
 * eso usa `/suscripcion/aviso`, que devuelve la fecha y qué está en juego pero NO precios ni
 * historial de pagos: el apartado "Mi suscripción" sigue siendo interno hasta que estén los precios
 * definidos. El link a la pestaña sólo aparece para quien la tiene.
 *
 * Además del cartel, el backend manda un mail unos días antes (services/suscripciones.
 * avisar_vencimientos): el que no entra a la app durante una semana se entera igual.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { esAdminReal, esEmpleado } from '@/lib/cuenta';
import { formatDate } from '@/lib/utils';
import { obtenerAvisoSuscripcion, type AvisoSuscripcion } from '@/services/suscripcionService';

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

/** Qué avisar, si es que hay algo que avisar. El backend ya decidió si corresponde (`hay_aviso`);
 *  acá sólo se redacta. */
function avisoDe(s: AvisoSuscripcion): Aviso | null {
  if (!s.hay_aviso) return null;
  const dias = s.dias_restantes;

  if (s.estado === 'vencida' || (dias !== null && dias !== undefined && dias < 0)) {
    return {
      tono: 'danger',
      titulo: s.vence
        ? `Tu suscripción venció el ${formatDate(s.vence)}`
        : 'Tenés un período pendiente de pago',
      detalle: s.se_pierde.length
        ? `Hasta que se regularice no vas a poder usar: ${s.se_pierde.join(', ')}. Tu cartera de ` +
          'clientes, las alertas y los recordatorios siguen como están. Escribinos y lo ' +
          'resolvemos en el día.'
        : 'Escribinos y lo regularizamos en el día.',
    };
  }

  if (dias === null || dias === undefined || !s.vence) return null;
  const cuando =
    dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días (${formatDate(s.vence)})`;
  return {
    tono: 'warning',
    titulo:
      s.estado === 'prueba'
        ? `Tu período de prueba termina ${cuando}`
        : `Tu suscripción vence ${cuando}`,
    detalle: s.se_pierde.length
      ? `Si no llegamos a renovarla vas a dejar de tener: ${s.se_pierde.join(', ')}. Escribinos y ` +
        'lo resolvemos en el día.'
      : 'Escribinos y lo resolvemos en el día.',
  };
}

export function BannerSuscripcion() {
  // Los usuarios del equipo no tienen suscripción propia (se cubren con la del titular): a ellos no
  // les mostramos nada, no es su decisión ni su información.
  const habilitado = !esEmpleado();
  const { data: aviso } = useQuery({
    queryKey: ['suscripcion', 'aviso'],
    queryFn: obtenerAvisoSuscripcion,
    enabled: habilitado,
  });
  const [pospuesto, setPospuesto] = useState(pospuestoHoy);

  if (!habilitado || !aviso) return null;
  const texto = avisoDe(aviso);
  if (!texto) return null;

  const esUrgente = texto.tono === 'danger';
  if (!esUrgente && pospuesto) return null;

  const Icono = esUrgente ? AlertTriangle : CalendarClock;
  // El apartado con los planes y la facturación todavía es interno: sólo enlazamos a quien lo tiene.
  const verApartado = esAdminReal();

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
            {texto.titulo}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{texto.detalle}</p>
          {verApartado && (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link to="/configuracion?tab=suscripcion">
                Ver mi suscripción <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
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
