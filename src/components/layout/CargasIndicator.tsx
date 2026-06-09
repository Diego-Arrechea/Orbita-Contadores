import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { useCargas, type CargaJob } from '@/context/CargasContext';

/**
 * Indicador en el header de las cargas de clientes en segundo plano. Mientras hay cargas activas
 * muestra un spinner con el contador; al abrirlo, el detalle con el progreso de cada una. Las
 * terminadas quedan con su resumen hasta que el contador las descarta.
 */
export function CargasIndicator() {
  const { cargas, activas, descartar } = useCargas();
  if (cargas.length === 0) return null;

  const hayActivas = activas.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative inline-flex h-10 items-center gap-2 rounded-xl px-3 hover:bg-muted transition-colors"
          title="Cargas en segundo plano"
          aria-label="Cargas de clientes en segundo plano"
        >
          {hayActivas ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <span className="text-sm font-medium tabular-nums hidden sm:inline">
            {hayActivas ? `Cargando ${activas.length}` : 'Cargas listas'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="px-3 py-2.5 border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Cargas de clientes
        </div>
        <div className="max-h-80 overflow-auto p-2 space-y-2">
          {cargas.map(c => (
            <CargaItem key={c.jobId} carga={c} onDescartar={() => descartar(c.jobId)} />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CargaItem({ carga, onDescartar }: { carga: CargaJob; onDescartar: () => void }) {
  const ok = carga.resultados.filter(r => r.ok).length;
  const fallaron = carga.resultados.filter(r => !r.ok).length;
  const enProceso = carga.estado === 'en_proceso';

  const subtitulo = enProceso
    ? carga.mensaje
    : carga.estado === 'error'
      ? carga.error || 'No se pudo completar'
      : `${ok} conectado${ok === 1 ? '' : 's'}${fallaron ? `, ${fallaron} con error` : ''}`;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start gap-2">
        {enProceso ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5 shrink-0" />
        ) : carga.estado === 'error' ? (
          <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{carga.titulo}</div>
          <div className="text-xs text-muted-foreground truncate">{subtitulo}</div>
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
      {enProceso && (
        <div className="mt-2">
          <Progress value={carga.progreso} className="h-1.5" />
          <div className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">
            {carga.progreso}%
          </div>
        </div>
      )}
    </div>
  );
}
