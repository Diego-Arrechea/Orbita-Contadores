import { useEffect, useState } from 'react';
import { MailWarning, Loader2, CheckCircle2 } from 'lucide-react';
import { getMe, reenviarConfirmacion } from '@/services/authService';
import { actualizarUsuarioGuardado, impersonando, usuarioActual } from '@/lib/cuenta';

/**
 * Banner global que pide confirmar el correo mientras la cuenta no esté confirmada (enforcement
 * SUAVE: el contador igual usa la app). El botón reenvía el enlace de confirmación.
 *
 * Arranca con lo que haya en localStorage y refresca contra el backend al montar: las sesiones
 * previas a la feature no traen `email_confirmado`, así que esperamos al /me antes de decidir si
 * mostrarlo (evita un flash en cuentas ya confirmadas). No se muestra durante una impersonación
 * (es la casilla del contador, no la del admin de soporte).
 */
export function ConfirmacionEmailBanner() {
  // null = todavía no sabemos (sesión vieja sin el campo) → no mostramos hasta confirmar con /me.
  const [confirmado, setConfirmado] = useState<boolean | null>(() => {
    const u = usuarioActual();
    if (!u) return true; // sin sesión: el banner no aplica
    return u.email_confirmado ?? null;
  });
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');

  useEffect(() => {
    getMe()
      .then(u => {
        actualizarUsuarioGuardado(u);
        setConfirmado(u.email_confirmado ?? true);
      })
      .catch(() => {});
  }, []);

  async function reenviar() {
    setEstado('enviando');
    try {
      await reenviarConfirmacion();
      setEstado('enviado');
    } catch {
      setEstado('error');
    }
  }

  if (confirmado !== false) return null; // confirmado o estado desconocido todavía
  if (impersonando()) return null; // no molestamos con la casilla del contador impersonado

  const email = usuarioActual()?.email;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-warning/20 text-warning-foreground px-4 py-2 text-sm">
      <MailWarning className="h-4 w-4 shrink-0" />
      {estado === 'enviado' ? (
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Te enviamos el correo de confirmación{email ? ` a ${email}` : ''}. Revisá tu casilla
          (y la carpeta de spam).
        </span>
      ) : (
        <>
          <span>
            Confirmá tu correo{email ? <> (<strong>{email}</strong>)</> : ''} para terminar de
            activar tu cuenta.
          </span>
          <button
            onClick={reenviar}
            disabled={estado === 'enviando'}
            className="inline-flex items-center gap-1.5 rounded-md bg-warning-foreground/10 px-2.5 py-1 font-medium hover:bg-warning-foreground/20 transition-colors disabled:opacity-60"
          >
            {estado === 'enviando' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando…
              </>
            ) : (
              'Enviar correo'
            )}
          </button>
          {estado === 'error' && (
            <span className="text-xs">No se pudo enviar. Probá de nuevo en un momento.</span>
          )}
        </>
      )}
    </div>
  );
}
