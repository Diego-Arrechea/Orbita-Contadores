import { CargasIndicator } from './CargasIndicator';
import { SyncIndicator } from './SyncIndicator';
import { NotificacionesIndicator } from './NotificacionesIndicator';
import { SincronizarTodo } from './SincronizarTodo';
import { TrialIndicator } from './TrialIndicator';

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center gap-4 border-b border-border/60 bg-background/70 px-10 2xl:px-14 backdrop-blur-md">
      <div className="ml-auto flex items-center gap-4">
        <TrialIndicator />
        <CargasIndicator />
        <SyncIndicator />
        <NotificacionesIndicator />
        <SincronizarTodo />
      </div>
    </header>
  );
}
