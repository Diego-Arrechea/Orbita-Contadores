import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, HelpCircle, CheckCircle2, ChevronRight, Check, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Severidad, TipoAlerta } from '@/lib/alertas';
import { useAlertas } from '@/lib/useAlertas';
import { useAlertasVistas } from '@/lib/alertasVistas';

const META: Record<Severidad, { label: string; icon: typeof AlertCircle; classes: string }> = {
  urgente: { label: 'Urgente', icon: AlertCircle, classes: 'bg-danger/10 text-danger' },
  aviso: { label: 'Aviso', icon: AlertTriangle, classes: 'bg-warning/20 text-warning-foreground' },
  datos: { label: 'Sin datos', icon: HelpCircle, classes: 'bg-muted text-muted-foreground' },
  ok: { label: 'OK', icon: CheckCircle2, classes: 'bg-success/10 text-success' },
};

const TIPO_LABEL: Record<TipoAlerta, string> = {
  tope: 'Tope',
  recategorizacion: 'Recategorización',
  ventana: 'Ventana',
  exclusion: 'Exclusión',
  cuota: 'Cuota',
  meses_adeudados: 'Meses adeudados',
  sync: 'Sincronización',
};

export function Alertas() {
  const [filtro, setFiltro] = useState<Severidad | 'todas'>('todas');
  const { alertas, conteo } = useAlertas();
  const { vistas, marcarVista, desmarcarVista } = useAlertasVistas();

  const visibles = filtro === 'todas' ? alertas : alertas.filter(a => a.severidad === filtro);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Alertas</h1>
        <p className="text-base text-muted-foreground mt-2">
          Todo lo que tu cartera necesita que mires hoy, ordenado por urgencia.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <ResumenCard
          label="Urgentes"
          value={conteo.urgente}
          icon={<AlertCircle className="h-5 w-5" />}
          tint="bg-danger/10 text-danger"
          active={filtro === 'urgente'}
          onClick={() => setFiltro(filtro === 'urgente' ? 'todas' : 'urgente')}
        />
        <ResumenCard
          label="Avisos"
          value={conteo.aviso}
          icon={<AlertTriangle className="h-5 w-5" />}
          tint="bg-warning/20 text-warning-foreground"
          active={filtro === 'aviso'}
          onClick={() => setFiltro(filtro === 'aviso' ? 'todas' : 'aviso')}
        />
        <ResumenCard
          label="Sin datos"
          value={conteo.datos}
          icon={<HelpCircle className="h-5 w-5" />}
          tint="bg-muted text-muted-foreground"
          active={filtro === 'datos'}
          onClick={() => setFiltro(filtro === 'datos' ? 'todas' : 'datos')}
        />
      </div>

      {visibles.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-3" />
          <div className="font-medium">
            {alertas.length === 0 ? 'Todo en orden' : 'No hay alertas de ese tipo'}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {alertas.length === 0
              ? 'No hay alertas en tu cartera por ahora.'
              : 'Probá con otro filtro o mirá todas.'}
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-border/60 overflow-hidden">
          {visibles.map(a => {
            const meta = META[a.severidad];
            const Icon = meta.icon;
            const vista = vistas.has(a.id);
            return (
              <div
                key={a.id}
                className={`flex items-center gap-4 p-4 transition-colors group ${vista ? 'bg-muted/20' : 'hover:bg-muted/30'}`}
              >
                <Link
                  to={`/clientes/${a.clienteId}`}
                  className={`flex items-center gap-4 min-w-0 flex-1 ${vista ? 'opacity-60' : ''}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.classes}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium leading-tight">{a.titulo}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {TIPO_LABEL[a.tipo]}
                      </Badge>
                      {vista && (
                        <Badge variant="secondary" className="text-[10px]">
                          Vista
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{a.detalle}</div>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="text-sm font-medium group-hover:text-primary transition-colors">
                      {a.clienteNombre}
                    </div>
                    <div className="text-xs text-muted-foreground">Ver ficha</div>
                  </div>
                </Link>
                {vista ? (
                  <button
                    onClick={() => desmarcarVista(a.id)}
                    title="Marcar como no vista"
                    aria-label="Marcar como no vista"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Undo2 className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => marcarVista(a.id)}
                    title="Marcar como vista"
                    aria-label="Marcar como vista"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

interface ResumenCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  tint: string;
  active?: boolean;
  onClick?: () => void;
}

function ResumenCard({ label, value, icon, tint, active, onClick }: ResumenCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-card border ${
        active ? 'border-primary/40 shadow-card-lg' : 'border-border/60 shadow-card'
      } rounded-2xl p-4 sm:p-6 transition-all hover:border-primary/40 hover:shadow-card-lg`}
    >
      <div className="flex items-center justify-between mb-3 sm:mb-5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}>{icon}</div>
      </div>
      <div className="text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight">{value}</div>
    </button>
  );
}
