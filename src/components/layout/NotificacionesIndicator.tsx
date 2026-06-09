import { Link } from 'react-router-dom';
import { Bell, AlertCircle, AlertTriangle, HelpCircle, CheckCircle2, ChevronRight, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { useAlertas } from '@/lib/useAlertas';
import { useAlertasVistas } from '@/lib/alertasVistas';
import type { Severidad } from '@/lib/alertas';

const META: Record<Severidad, { icon: typeof AlertCircle; classes: string }> = {
  urgente: { icon: AlertCircle, classes: 'bg-danger/10 text-danger' },
  aviso: { icon: AlertTriangle, classes: 'bg-warning/20 text-warning-foreground' },
  datos: { icon: HelpCircle, classes: 'bg-muted text-muted-foreground' },
  ok: { icon: CheckCircle2, classes: 'bg-success/10 text-success' },
};

// Cuántas alertas listamos en el dropdown antes del "Ver todas".
const MAX_VISIBLES = 6;

/**
 * Campanita del header: acceso rápido a las alertas de la cartera. El badge cuenta lo que pide
 * atención (urgentes + avisos) y se pinta en rojo si hay urgentes. Al abrirla, muestra las
 * primeras alertas ordenadas por urgencia, con link a la ficha de cada cliente, y un pie para
 * ver el centro de alertas completo. Comparte la fuente con /alertas vía useAlertas().
 */
export function NotificacionesIndicator() {
  const { alertas } = useAlertas();
  const { vistas, marcarVista } = useAlertasVistas();
  // La campanita sólo muestra lo que pide atención y todavía no se marcó como visto. Las vistas
  // siguen vivas en el centro de alertas (/alertas); acá nada más se ocultan.
  const sinVer = alertas.filter(a => a.severidad !== 'ok' && !vistas.has(a.id));
  const urgentes = sinVer.filter(a => a.severidad === 'urgente').length;
  const avisos = sinVer.filter(a => a.severidad === 'aviso').length;
  const pendientes = urgentes + avisos;
  const visibles = sinVer.slice(0, MAX_VISIBLES);
  const restantes = sinVer.length - visibles.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted transition-colors"
          title="Alertas de tu cartera"
          aria-label={pendientes > 0 ? `${pendientes} alertas pendientes` : 'Sin alertas pendientes'}
        >
          <Bell className="h-4 w-4" />
          {pendientes > 0 && (
            <Badge
              variant={urgentes > 0 ? 'danger' : 'warning'}
              className="absolute -top-1 -right-1 h-5 min-w-5 justify-center px-1 text-[10px] leading-none"
            >
              {pendientes > 99 ? '99+' : pendientes}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Alertas
          </span>
          {pendientes > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {urgentes > 0 && `${urgentes} urgente${urgentes === 1 ? '' : 's'}`}
              {urgentes > 0 && avisos > 0 && ' · '}
              {avisos > 0 && `${avisos} aviso${avisos === 1 ? '' : 's'}`}
            </span>
          )}
        </div>

        {visibles.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
            <div className="text-sm font-medium">Todo en orden</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              No hay alertas en tu cartera por ahora.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-auto divide-y divide-border/60">
            {visibles.map(a => {
              const meta = META[a.severidad];
              const Icon = meta.icon;
              return (
                <div key={a.id} className="flex items-start gap-2 px-3 py-2.5 hover:bg-muted/40 transition-colors group">
                  <Link to={`/clientes/${a.clienteId}`} className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.classes}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-tight truncate">{a.titulo}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.detalle}</div>
                      <div className="text-xs text-muted-foreground/80 mt-0.5 truncate">
                        {a.clienteNombre}
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => marcarVista(a.id)}
                    title="Marcar como vista"
                    aria-label="Marcar como vista"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <Link
          to="/alertas"
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-border/60 text-sm font-medium text-primary hover:bg-muted/40 transition-colors"
        >
          {restantes > 0 ? `Ver todas (${restantes} más)` : 'Ver centro de alertas'}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
