import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTema } from '@/lib/tema';
import type { PreferenciaTema } from '@/lib/tema';

const OPCIONES: { valor: PreferenciaTema; label: string; icono: LucideIcon }[] = [
  { valor: 'claro', label: 'Claro', icono: Sun },
  { valor: 'oscuro', label: 'Oscuro', icono: Moon },
  { valor: 'sistema', label: 'Automático', icono: Monitor },
];

/**
 * Botón de apariencia: abre un menú con Claro / Oscuro / Automático (este último sigue al
 * dispositivo). Vive en el header de la app y en las pantallas de acceso.
 */
export function SelectorTema({ className }: { className?: string }) {
  const { preferencia, efectivo, elegir } = useTema();
  const Actual = efectivo === 'oscuro' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
          title="Apariencia"
          aria-label="Cambiar la apariencia"
        >
          <Actual className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {OPCIONES.map(({ valor, label, icono: Icono }) => (
          <DropdownMenuItem key={valor} onSelect={() => elegir(valor)}>
            <Icono />
            <span className="flex-1">{label}</span>
            {preferencia === valor && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
