import { RefreshCcw, CheckCircle2, XCircle, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { useSync, type SyncJob } from '@/context/SyncContext';

/**
 * Indicador en el header de las sincronizaciones en curso. Mientras hay alguna activa muestra un
 * ícono de flechas girando con el contador (1, 2, 3…); al abrirlo, el detalle de cada una. Las
 * exitosas se autodescartan; los errores quedan hasta que el contador los cierre.
 */
export function SyncIndicator() {
  const { syncs, activas, descartar } = useSync();
  if (syncs.length === 0) return null;

  const hayActivas = activas.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative inline-flex h-10 items-center gap-2 rounded-xl px-3 hover:bg-muted transition-colors"
          title="Sincronizaciones en curso"
          aria-label="Sincronizaciones en curso"
        >
          <RefreshCcw
            className={hayActivas ? 'h-4 w-4 animate-spin text-primary' : 'h-4 w-4 text-success'}
          />
          {hayActivas && (
            <span className="text-sm font-medium tabular-nums">{activas.length}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="px-3 py-2.5 border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Sincronizaciones
        </div>
        <div className="max-h-80 overflow-auto p-2 space-y-2">
          {syncs.map(s => (
            <SyncItem key={s.cuit} sync={s} onDescartar={() => descartar(s.cuit)} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SyncItem({ sync, onDescartar }: { sync: SyncJob; onDescartar: () => void }) {
  const enProceso = sync.estado === 'en_proceso';
  const subtitulo = enProceso
    ? sync.mensaje || 'Sincronizando…'
    : sync.estado === 'error'
      ? sync.error || 'No se pudo sincronizar'
      : typeof sync.comprobantes === 'number'
        ? sync.comprobantes === 0
          ? 'Actualizado · sin comprobantes nuevos'
          : `Actualizado · ${sync.comprobantes} comprobante${sync.comprobantes === 1 ? '' : 's'} nuevo${sync.comprobantes === 1 ? '' : 's'}`
        : 'Actualizado';

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-2">
        {enProceso ? (
          <RefreshCcw className="h-4 w-4 animate-spin text-primary mt-0.5 shrink-0" />
        ) : sync.estado === 'error' ? (
          <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{sync.nombre}</div>
          <div className="text-xs text-muted-foreground break-words">{subtitulo}</div>
        </div>
        {!enProceso && (
          <button
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onDescartar();
            }}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Descartar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {enProceso && sync.progreso > 0 && (
        <div className="mt-2">
          <Progress value={sync.progreso} className="h-1.5" />
        </div>
      )}
    </div>
  );
}
