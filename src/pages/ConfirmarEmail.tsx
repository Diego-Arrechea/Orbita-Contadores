import { useEffect, useRef, useState } from 'react';
import { AccesoLayout } from '@/components/layout/AccesoLayout';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { confirmarEmail, getMe, mensajeDeError } from '@/services/authService';
import { actualizarUsuarioGuardado, tokenActual } from '@/lib/cuenta';

/**
 * Confirmación de email. Llega desde el enlace del correo con ?token=… y confirma la cuenta apenas
 * carga. Ruta PÚBLICA (fuera del guard de sesión): el contador puede abrirla sin estar logueado,
 * incluso desde otro dispositivo. Si hay sesión abierta, refresca el usuario guardado para que el
 * banner "confirmá tu correo" desaparezca al volver a la app.
 */
export function ConfirmarEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [error, setError] = useState<string | null>(null);
  // El enlace puede dispararse dos veces (StrictMode en dev): confirmamos una sola vez.
  const yaIntento = useRef(false);

  useEffect(() => {
    if (yaIntento.current) return;
    yaIntento.current = true;
    if (!token) {
      setEstado('error');
      setError('El enlace no es válido. Pedí uno nuevo desde la app.');
      return;
    }
    confirmarEmail(token)
      .then(async () => {
        // Si hay sesión, traemos el usuario fresco (ya confirmado) para apagar el banner.
        if (tokenActual()) {
          await getMe().then(actualizarUsuarioGuardado).catch(() => {});
        }
        setEstado('ok');
      })
      .catch(err => {
        setEstado('error');
        setError(mensajeDeError(err));
      });
  }, [token]);

  return (
    <AccesoLayout>
      <div className="w-full">
        <div className=" text-center">
          {estado === 'cargando' && (
            <div className="space-y-3 py-4">
              <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">Confirmando tu correo…</p>
            </div>
          )}

          {estado === 'ok' && (
            <div className="space-y-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success mx-auto">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight mb-1.5">¡Correo confirmado!</h1>
                <p className="text-sm text-muted-foreground">
                  Tu dirección de correo quedó confirmada. Ya está todo listo.
                </p>
              </div>
              <Link
                to={tokenActual() ? '/' : '/login'}
                className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {tokenActual() ? 'Ir a mi panel' : 'Ingresar'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {estado === 'error' && (
            <div className="space-y-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger mx-auto">
                <AlertCircle className="h-7 w-7" />
              </div>
              <div>
                <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight mb-1.5">No pudimos confirmar tu correo</h1>
                <p className="text-sm text-muted-foreground">
                  {error ?? 'El enlace no es válido o ya expiró.'}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Ingresá a la app y volvé a pedir el enlace desde el aviso de la parte superior.
              </p>
              <Link
                to={tokenActual() ? '/' : '/login'}
                className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
              >
                {tokenActual() ? 'Ir a mi panel' : 'Ir a ingresar'}
              </Link>
            </div>
          )}
        </div>
      </div>
    </AccesoLayout>
  );
}
