import { Menu } from 'lucide-react';
import { esEmpleado } from '@/lib/cuenta';
import { CargasIndicator } from './CargasIndicator';
import { PreparacionesIndicator } from './PreparacionesIndicator';
import { NotificacionesIndicator } from './NotificacionesIndicator';
import { NovedadesIndicator } from './NovedadesIndicator';
import { SelectorTema } from '@/components/shared/SelectorTema';

export function Topbar({ onAbrirMenu }: { onAbrirMenu?: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 shadow-[0_1px_0_hsl(var(--hairline))] bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:h-20 lg:px-10 2xl:px-14">
      {/* Disparador del menú + logo, sólo en mobile (el riel de escritorio ya muestra ambos). */}
      <button
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <span className="font-display text-2xl font-semibold leading-none tracking-[-0.03em] lg:hidden">
        órbita<span className="text-primary">.</span>
      </span>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <SelectorTema />
        <CargasIndicator />
        <PreparacionesIndicator />
        {/* Los usuarios del estudio no ven Novedades (navegación restringida). */}
        {!esEmpleado() && <NovedadesIndicator />}
        <NotificacionesIndicator />
      </div>
    </header>
  );
}
