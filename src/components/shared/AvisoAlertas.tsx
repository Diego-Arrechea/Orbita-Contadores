/**
 * Modal de lanzamiento de las alertas: avisa a los contadores que ya existían que el servicio está
 * activo y que pueden configurarlo. Se muestra en sus próximos ingresos (lo controla el backend con
 * `aviso_alertas_pendiente`), una vez por sesión del navegador, hasta agotarse o hasta que toquen
 * "Entendido". Se monta global en AppLayout.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getMe, registrarAvisoAlertas } from '@/services/authService';
import { actualizarUsuarioGuardado, usuarioActual, SS_AVISO_ALERTAS } from '@/lib/cuenta';

// Guard por sesión del navegador: que un refresh no "queme" otro de los ingresos. `iniciarSesion` lo
// limpia en cada login para que el modal se re-evalúe al cambiar de cuenta (ver cuenta.ts).
const LS_SESION = SS_AVISO_ALERTAS;

export function AvisoAlertas() {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(LS_SESION)) return; // ya se evaluó/mostró en esta sesión
    // Traemos el estado fresco del backend: los contadores que ya estaban logueados tienen el usuario
    // viejo en localStorage (sin el campo), así que no alcanza con leer la sesión local.
    getMe()
      .then(u => {
        actualizarUsuarioGuardado(u);
        if ((u.aviso_alertas_pendiente ?? 0) <= 0) return;
        sessionStorage.setItem(LS_SESION, '1');
        setAbierto(true);
        registrarAvisoAlertas(false)
          .then(r => actualizarUsuarioGuardado({ ...u, aviso_alertas_pendiente: r.aviso_alertas_pendiente }))
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  // "Entendido" / "Configurar": lo apaga del todo (descartar) y refresca la sesión.
  function descartar() {
    const actual = usuarioActual();
    if (actual) actualizarUsuarioGuardado({ ...actual, aviso_alertas_pendiente: 0 });
    registrarAvisoAlertas(true).catch(() => {});
  }

  function configurar() {
    descartar();
    setAbierto(false);
    navigate('/configuracion?tab=umbrales');
  }

  function entendido() {
    descartar();
    setAbierto(false);
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> Ya podés configurar tus alertas
          </DialogTitle>
          <DialogDescription>
            El servicio de alertas de tu cartera ya está activo. Elegí qué novedades querés recibir
            (tope, recategorización, cuotas, vencimientos…) y con qué criterio — lo configurás como
            mejor te quede, y podés recibirlas también por WhatsApp.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={entendido}>
            Entendido
          </Button>
          <Button onClick={configurar}>
            <Bell className="h-4 w-4" /> Configurar mis alertas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
