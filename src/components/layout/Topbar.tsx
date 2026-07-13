import { Menu, Orbit } from 'lucide-react';
import { esEmpleado } from '@/lib/cuenta';
import { CargasIndicator } from './CargasIndicator';
import { PreparacionesIndicator } from './PreparacionesIndicator';
import { NotificacionesIndicator } from './NotificacionesIndicator';
import { NovedadesIndicator } from './NovedadesIndicator';

export function Topbar({ onAbrirMenu }: { onAbrirMenu?: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-md sm:px-6 lg:h-20 lg:px-10 2xl:px-14">
      {/* Disparador del menú + logo, sólo en mobile (el riel de escritorio ya muestra ambos). */}
      <button
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex items-center gap-2 lg:hidden">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Orbit className="h-4 w-4" />
        </div>
        <span className="font-semibold tracking-tight">Órbita</span>
      </div>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <CargasIndicator />
        <PreparacionesIndicator />
        {/* Los usuarios del estudio no ven Novedades (navegación restringida). */}
        {!esEmpleado() && <NovedadesIndicator />}
        <NotificacionesIndicator />
      </div>
    </header>
  );
}
