import { Search, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center gap-4 border-b border-border/60 bg-background/70 px-10 2xl:px-14 backdrop-blur-md">
      <div className="relative flex-1 max-w-lg">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente por nombre o CUIT..."
          className="pl-10 bg-card/70 border-transparent focus-visible:bg-card focus-visible:border-input h-11"
        />
      </div>
      <div className="ml-auto flex items-center gap-4">
        <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <Bell className="h-4 w-4" />
          <Badge
            variant="danger"
            className="absolute -top-1 -right-1 h-5 min-w-5 justify-center px-1 text-[10px] leading-none"
          >
            3
          </Badge>
        </button>
        <div className="text-right hidden sm:block">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
            Última sincronización
          </div>
          <div className="text-sm font-medium tabular-nums">Hoy, 03:15 AM</div>
        </div>
      </div>
    </header>
  );
}
