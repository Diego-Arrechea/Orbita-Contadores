import { Loader2, CheckCircle2, XCircle, X, FileKey2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { usePreparaciones, type PrepFactura } from '@/context/PreparacionesContext';

/**
 * Indicador en el header de las habilitaciones de facturación en segundo plano (cuando el contador
 * cierra el diálogo y sigue trabajando). Mientras hay activas muestra un spinner con el contador; al
 * abrirlo, el detalle de cada una. Las terminadas quedan con su resumen hasta que se descartan.
 */
export function PreparacionesIndicator() {
  const { preparaciones, activas, descartar } = usePreparaciones();
  if (preparaciones.length === 0) return null;

  const hayActivas = activas.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative inline-flex h-10 items-center gap-2 rounded-xl px-3 hover:bg-muted transition-colors"
          title="Habilitaciones de facturación en segundo plano"
          aria-label="Habilitaciones de facturación en segundo plano"
        >
          {hayActivas ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <FileKey2 className="h-4 w-4 text-success" />
          )}
          <span className="text-sm font-medium tabular-nums hidden sm:inline">
            {hayActivas ? `Habilitando ${activas.length}` : 'Facturación lista'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="px-3 py-2.5 border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Habilitación de facturación
        </div>
        <div className="max-h-80 overflow-auto p-2 space-y-2">
          {preparaciones.map(p => (
            <PrepItem key={p.jobId} prep={p} onDescartar={() => descartar(p.jobId)} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PrepItem({ prep, onDescartar }: { prep: PrepFactura; onDescartar: () => void }) {
  const enProceso = prep.estado === 'en_proceso';
  const subtitulo = enProceso
    ? prep.mensaje
    : prep.estado === 'error'
      ? prep.error || 'No se pudo habilitar'
      : 'Lista para emitir comprobantes';

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-2">
        {enProceso ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5 shrink-0" />
        ) : prep.estado === 'error' ? (
          <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{prep.nombre}</div>
          <div className="text-xs text-muted-foreground truncate">{subtitulo}</div>
        </div>
        {!enProceso && (
          <button
            onClick={onDescartar}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Descartar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {enProceso && (
        <div className="mt-2">
          <Progress value={prep.progreso} className="h-1.5" />
          <div className="mt-1 text-right">
            <span className="text-[11px] text-muted-foreground tabular-nums">{prep.progreso}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
