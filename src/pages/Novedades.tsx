import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { NOVEDADES, TIPO_NOVEDAD_META } from '@/data/novedades';
import { useNovedadesVistas } from '@/lib/novedadesVistas';

/**
 * "Novedades": bitácora de cambios y mejoras del sistema, visible para todos los contadores.
 * Al entrar, marca todas las novedades como vistas (limpia el puntito del header).
 */
export function Novedades() {
  const { vistas, marcarTodasVistas } = useNovedadesVistas();

  useEffect(() => {
    marcarTodasVistas();
  }, [marcarTodasVistas]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Novedades</h1>
        <p className="text-base text-muted-foreground mt-2">
          Todo lo que vamos mejorando en Órbita, de lo más reciente a lo más viejo.
        </p>
      </div>

      <div className="relative space-y-5 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border md:before:left-[9px]">
        {NOVEDADES.map(nov => {
          const esNueva = !vistas.has(nov.id);
          return (
            <div key={nov.id} className="relative pl-7 md:pl-9">
              {/* Punto del timeline */}
              <span
                className={
                  'absolute left-0 top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-background md:h-[18px] md:w-[18px] ' +
                  (esNueva ? 'bg-primary' : 'bg-border')
                }
              />
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">{nov.titulo}</h2>
                  {esNueva && (
                    <Badge variant="success" className="gap-1">
                      <Sparkles className="h-3 w-3" /> Nuevo
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {formatDate(nov.fecha)}
                  </span>
                </div>

                {nov.resumen && (
                  <p className="mt-1.5 text-sm text-muted-foreground">{nov.resumen}</p>
                )}

                <ul className="mt-4 space-y-2.5">
                  {nov.items.map((item, i) => {
                    const meta = TIPO_NOVEDAD_META[item.tipo];
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <Badge variant={meta.tono} className="mt-0.5 shrink-0">
                          {meta.label}
                        </Badge>
                        <span className="leading-relaxed">{item.texto}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
