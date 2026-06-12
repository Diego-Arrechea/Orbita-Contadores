import { CheckCircle2, XCircle, X } from 'lucide-react';
import { useCargas } from '@/context/CargasContext';

/**
 * Toasts transitorios que avisan cuando una carga de cliente (alta) termina de traer sus
 * comprobantes y datos. Aparecen abajo a la derecha y se van solos a los 5 s (lógica en
 * CargasContext). Se montan una vez, por encima del router (ver App.tsx).
 */
export function CargasToasts() {
  const { avisos, descartarAviso } = useCargas();
  if (avisos.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {avisos.map(a => (
        <div
          key={a.id}
          role="status"
          className="flex w-80 items-start gap-2 rounded-xl border border-border/60 bg-card p-3 shadow-lg animate-in slide-in-from-right-4 fade-in"
        >
          {a.tipo === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{a.titulo}</div>
            <div className="text-xs text-muted-foreground">{a.mensaje}</div>
          </div>
          <button
            onClick={() => descartarAviso(a.id)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Descartar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
