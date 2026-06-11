import { Clock } from 'lucide-react';
import { usuarioActual } from '@/lib/cuenta';

/**
 * Badge del período de prueba GRATIS en el header. Calcula los días restantes desde `trial_fin`
 * (no del snapshot del backend, para que no quede viejo entre cargas). Oculto para admins (no están
 * en prueba) y si la cuenta no tiene trial. Cambia de tono cuando faltan pocos días o ya venció.
 */
export function TrialIndicator() {
  const u = usuarioActual();
  if (!u || u.rol === 'admin' || !u.trial_fin) return null;

  const fin = new Date(u.trial_fin).getTime();
  if (Number.isNaN(fin)) return null;

  const dias = Math.max(0, Math.ceil((fin - Date.now()) / 86400000));
  const vencido = dias <= 0;
  const porVencer = !vencido && dias <= 5;
  const finFecha = new Date(u.trial_fin).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const tono = vencido
    ? 'border-danger/30 bg-danger/10 text-danger'
    : porVencer
      ? 'border-warning/40 bg-warning/10 text-warning-foreground'
      : 'border-primary/25 bg-primary/10 text-primary';

  return (
    <div
      className={`hidden sm:flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${tono}`}
      title={
        vencido
          ? `Tu prueba gratis terminó el ${finFecha}`
          : `Prueba gratis hasta el ${finFecha}`
      }
    >
      <Clock className="h-3.5 w-3.5" />
      {vencido ? 'Prueba finalizada' : `Prueba gratis · ${dias} ${dias === 1 ? 'día' : 'días'}`}
    </div>
  );
}
