import { useNavigate } from 'react-router-dom';
import { UserCog, ArrowLeft } from 'lucide-react';
import { cuentaActual, impersonando, terminarImpersonacion } from '@/lib/cuenta';

/**
 * Banner global visible mientras un admin está "entrando como" otro contador. Permite volver a la
 * cuenta de admin en un clic. Si no hay impersonación en curso, no renderiza nada.
 */
export function ImpersonacionBanner() {
  const navigate = useNavigate();
  const admin = impersonando();
  if (!admin) return null;

  const cuenta = cuentaActual();

  function volver() {
    terminarImpersonacion();
    navigate('/admin');
    // Recarga para que todos los datos se re-pidan con el token de admin (limpio y simple).
    window.location.reload();
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-warning/20 text-warning-foreground px-4 py-2 text-sm">
      <UserCog className="h-4 w-4 shrink-0" />
      <span>
        Estás viendo la cuenta de <strong>{cuenta?.nombre}</strong> como soporte.
      </span>
      <button
        onClick={volver}
        className="inline-flex items-center gap-1.5 rounded-md bg-warning-foreground/10 px-2.5 py-1 font-medium hover:bg-warning-foreground/20 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a mi cuenta
      </button>
    </div>
  );
}
