import { useEffect, useState } from 'react';
import { RefreshCcw, Loader2, CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { useSync, type SyncTodosJob } from '@/context/SyncContext';
import { getClientesReales } from '@/services/clientesService';
import { cuentaActual } from '@/lib/cuenta';
import { formatDate } from '@/lib/utils';

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Duración legible entre dos timestamps (ms): "45 s", "2 min 15 s", "1 h 3 min". */
function formatDuracion(desde: number, hasta: number): string {
  const seg = Math.max(0, Math.round((hasta - desde) / 1000));
  if (seg < 60) return `${seg} s`;
  const min = Math.floor(seg / 60);
  const resto = seg % 60;
  if (min < 60) return resto ? `${min} min ${resto} s` : `${min} min`;
  const h = Math.floor(min / 60);
  const minResto = min % 60;
  return minResto ? `${h} h ${minResto} min` : `${h} h`;
}

/**
 * Botón "Sincronizar todos" + fecha real de la última sincronización, en el header. Dispara el job
 * secuencial de toda la cartera (SyncContext.sincronizarTodos). Mientras corre, el botón se vuelve un
 * panel desplegable con la barra de progreso, el cliente que se está sincronizando y los ya hechos;
 * al terminar, el resumen queda consultable hasta que el contador lo descarta con la "x".
 * La fecha sale de la cartera (comprobante más reciente) y se refresca al terminar (version).
 */
export function SincronizarTodo() {
  const { todos, sincronizarTodos, descartarTodos, version } = useSync();
  const [ultima, setUltima] = useState<string | null>(null);

  const enProceso = todos?.estado === 'en_proceso';
  const finalizado = todos?.estado === 'terminado' || todos?.estado === 'error';

  useEffect(() => {
    if (!cuentaActual()) return;
    getClientesReales()
      .then(cs => {
        const fechas = cs.map(c => c.ultimaExtraccion).filter((f): f is string => !!f);
        setUltima(fechas.length ? fechas.reduce((a, b) => (a > b ? a : b)) : null);
      })
      .catch(() => {});
  }, [version]);

  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden lg:block min-w-0">
        {enProceso ? (
          <>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
              Sincronizando
            </div>
            <div className="text-sm font-medium truncate max-w-[240px]">{todos.mensaje}</div>
          </>
        ) : ultima ? (
          <>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
              Última sincronización
            </div>
            <div className="text-sm font-medium tabular-nums">
              {formatDate(ultima)} · {formatHora(ultima)} hs
            </div>
          </>
        ) : null}
      </div>

      {enProceso || finalizado ? (
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
                title="Ver el detalle de la sincronización"
              >
                <Disparador todos={todos!} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <PanelDetalle todos={todos!} onResync={sincronizarTodos} />
            </DropdownMenuContent>
          </DropdownMenu>

          {finalizado && (
            <button
              onClick={descartarTodos}
              title="Descartar resultado"
              aria-label="Descartar resultado de la sincronización"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={sincronizarTodos}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card px-3.5 text-sm font-medium hover:bg-muted transition-colors"
          title="Sincronizar todos los clientes"
        >
          <RefreshCcw className="h-4 w-4" />
          <span className="hidden sm:inline">Sincronizar todos</span>
        </button>
      )}
    </div>
  );
}

/** Contenido del botón-disparador según el estado del job. */
function Disparador({ todos }: { todos: SyncTodosJob }) {
  if (todos.estado === 'en_proceso') {
    return (
      <>
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="tabular-nums">
          {todos.hechos}/{todos.total || '…'}
        </span>
      </>
    );
  }
  if (todos.estado === 'error') {
    return (
      <>
        <XCircle className="h-4 w-4 text-danger" />
        <span className="hidden sm:inline">No se pudo sincronizar</span>
      </>
    );
  }
  // terminado
  return todos.fallaron > 0 ? (
    <>
      <AlertTriangle className="h-4 w-4 text-warning-foreground" />
      <span className="tabular-nums">
        {todos.fallaron} de {todos.total} con error
      </span>
    </>
  ) : (
    <>
      <CheckCircle2 className="h-4 w-4 text-success" />
      <span className="hidden sm:inline">Sincronizado</span>
    </>
  );
}

/** Panel con el detalle del job: barra de progreso + cliente actual (en curso) o resumen (terminado),
 * y la lista por cliente con sus comprobantes nuevos / errores. */
function PanelDetalle({ todos, onResync }: { todos: SyncTodosJob; onResync: () => void }) {
  const enProceso = todos.estado === 'en_proceso';
  // Los ya procesados van más recientes primero (el cliente actual ya se ve arriba, en la cabecera).
  const hechos = [...todos.resultados].reverse();
  const nuevosTotal = todos.resultados.reduce((s, r) => s + (r.comprobantes ?? 0), 0);
  const duracion = todos.finalizadoEn ? formatDuracion(todos.iniciadoEn, todos.finalizadoEn) : null;

  return (
    <>
      <div className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {enProceso ? 'Sincronizando cartera' : todos.estado === 'error' ? 'No se pudo sincronizar' : 'Sincronización completada'}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {todos.hechos} de {todos.total || '…'}
          </span>
        </div>

        {enProceso ? (
          <>
            <Progress value={todos.progreso} className="h-1.5 mt-2.5" />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
              <span className="truncate">{todos.mensaje}</span>
            </div>
          </>
        ) : todos.estado === 'error' ? (
          <div className="mt-1.5 text-xs text-danger">{todos.error ?? 'Ocurrió un error.'}</div>
        ) : (
          <div className="mt-1.5 text-xs text-muted-foreground">
            {nuevosTotal > 0
              ? `${nuevosTotal} comprobante${nuevosTotal === 1 ? '' : 's'} nuevo${nuevosTotal === 1 ? '' : 's'}`
              : 'Sin comprobantes nuevos'}
            {todos.fallaron > 0 && ` · ${todos.fallaron} con error`}
          </div>
        )}
        {!enProceso && duracion && (
          <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">Tardó {duracion}</div>
        )}
      </div>

      {hechos.length > 0 && (
        <div className="max-h-72 overflow-auto p-2 space-y-1">
          {hechos.map(r => (
            <div key={r.cuit} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
              {r.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
              )}
              <span className="flex-1 truncate">{r.nombre || r.cuit}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {r.ok
                  ? r.comprobantes
                    ? `${r.comprobantes} nuevo${r.comprobantes === 1 ? '' : 's'}`
                    : 'sin novedades'
                  : 'error'}
              </span>
            </div>
          ))}
        </div>
      )}

      {!enProceso && (
        <button
          onClick={onResync}
          className="flex w-full items-center justify-center gap-1.5 px-3 py-2.5 border-t border-border/60 text-sm font-medium text-primary hover:bg-muted/40 transition-colors"
        >
          <RefreshCcw className="h-4 w-4" /> Sincronizar de nuevo
        </button>
      )}
    </>
  );
}
