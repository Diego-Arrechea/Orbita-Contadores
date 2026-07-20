import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ImpersonacionBanner } from './ImpersonacionBanner';
import { ConfirmacionEmailBanner } from './ConfirmacionEmailBanner';
import { SoporteChat } from '@/components/shared/SoporteChat';
import { AvisoAlertas } from '@/components/shared/AvisoAlertas';
import { TooltipProvider } from '@/components/ui/tooltip';

export function AppLayout() {
  // Estado del drawer mobile, compartido entre el botón hamburguesa (Topbar) y el Sidebar.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const location = useLocation();
  // El <main> es el contenedor que scrollea y NO se desmonta al navegar (sólo cambia el Outlet), así
  // que conserva el scrollTop de la pantalla anterior. Lo reseteamos a 0 en cada cambio de ruta para
  // que toda página se abra siempre arriba (si no, entrar a una ficha larga desde el dashboard
  // scrolleado la mostraba a media altura).
  const mainRef = useRef<HTMLElement>(null);

  // Cerramos el drawer al cambiar de ruta (red de seguridad para navegaciones que no pasan por un
  // NavLink del menú, ej. al tocar un cliente).
  useEffect(() => {
    setMenuAbierto(false);
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full">
        <Sidebar abiertoMobile={menuAbierto} onCerrarMobile={() => setMenuAbierto(false)} />
        <div className="flex flex-1 min-w-0 flex-col">
          <ImpersonacionBanner />
          <ConfirmacionEmailBanner />
          <Topbar onAbrirMenu={() => setMenuAbierto(true)} />
          <main ref={mainRef} className="flex-1 overflow-auto scrollbar-thin">
            <div className="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8 2xl:px-14">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <SoporteChat />
      <AvisoAlertas />
    </TooltipProvider>
  );
}
