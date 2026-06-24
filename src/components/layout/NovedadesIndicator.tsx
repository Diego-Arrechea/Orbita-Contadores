import { Link } from 'react-router-dom';
import { Sparkles, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { formatDate } from '@/lib/utils';
import { NOVEDADES } from '@/data/novedades';
import { useNovedadesVistas } from '@/lib/novedadesVistas';

// Cuántas novedades listamos en el dropdown antes del "Ver todas".
const MAX_VISIBLES = 4;

/**
 * Indicador del header con las novedades del producto. Muestra un puntito cuando hay novedades sin
 * ver; al abrirlo, las marca todas como vistas y ofrece el acceso a la página completa.
 */
export function NovedadesIndicator() {
  const { vistas, noVistas, marcarTodasVistas } = useNovedadesVistas();
  const visibles = NOVEDADES.slice(0, MAX_VISIBLES);
  const restantes = NOVEDADES.length - visibles.length;

  return (
    <DropdownMenu onOpenChange={open => open && marcarTodasVistas()}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted transition-colors"
          title="Novedades de Órbita"
          aria-label={noVistas > 0 ? `${noVistas} novedades sin ver` : 'Novedades'}
        >
          <Sparkles className="h-4 w-4" />
          {noVistas > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Novedades
          </span>
        </div>

        <div className="max-h-96 overflow-auto divide-y divide-border/60">
          {visibles.map(nov => {
            const esNueva = !vistas.has(nov.id);
            return (
              <Link
                key={nov.id}
                to="/novedades"
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium leading-tight truncate">{nov.titulo}</div>
                    {esNueva && (
                      <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px]">
                        Nuevo
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {nov.resumen ?? nov.items[0]?.texto}
                  </div>
                  <div className="text-xs text-muted-foreground/80 mt-0.5 tabular-nums">
                    {formatDate(nov.fecha)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <Link
          to="/novedades"
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-border/60 text-sm font-medium text-primary hover:bg-muted/40 transition-colors"
        >
          {restantes > 0 ? `Ver todas (${restantes} más)` : 'Ver todas las novedades'}
          <ChevronRight className="h-4 w-4" />
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
