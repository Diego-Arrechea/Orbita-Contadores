import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { SoporteChat } from '@/components/shared/SoporteChat';
import { TooltipProvider } from '@/components/ui/tooltip';

export function AppLayout() {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex flex-1 min-w-0 flex-col">
          <Topbar />
          <main className="flex-1 overflow-auto scrollbar-thin">
            <div className="w-full px-10 py-8 2xl:px-14">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <SoporteChat />
    </TooltipProvider>
  );
}
