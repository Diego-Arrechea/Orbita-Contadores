import { useState, type ReactNode } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import { eliminarCliente } from '@/services/clientesService';
import type { Cliente } from '@/types';

/**
 * Confirmación para eliminar un cliente. Es RECUPERABLE: borra el cache local de Órbita
 * (cliente + comprobantes en la DB), pero no toca ARCA; se puede volver a cargar.
 *  - Cliente real (fuente 'arca'): DELETE al backend + limpia la pertenencia y las ediciones locales.
 *  - Cliente mock: no llega acá (el botón sólo se muestra para reales).
 */
export function EliminarClienteDialog({
  cliente,
  onEliminado,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  cliente: Cliente;
  onEliminado: () => void;
  /** Opcional: si se omite, el diálogo se abre con su propio trigger. */
  trigger?: ReactNode;
  /** Open controlado (p. ej. desde un menú). Si se pasa, el trigger es opcional. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openInterno, setOpenInterno] = useState(false);
  const open = openProp ?? openInterno;
  const setOpen = onOpenChange ?? setOpenInterno;
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eliminar = async () => {
    setEliminando(true);
    setError(null);
    try {
      if (cliente.fuente === 'arca') await eliminarCliente(cliente.cuit);
      setOpen(false);
      onEliminado();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEliminando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !eliminando && setOpen(o)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger" />
            ¿Eliminar a {cliente.nombre}?
          </DialogTitle>
          <DialogDescription>
            Se borra de Órbita este cliente y todo su cache de comprobantes (ventas y compras). Los
            datos en ARCA no se tocan: podés volver a cargarlo cuando quieras y se traen de nuevo.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-danger/12 border border-danger/25 px-3.5 py-2.5 text-sm text-danger">
            No se pudo eliminar: {error}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={eliminando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={eliminar} disabled={eliminando}>
            <Trash2 className="h-4 w-4" />
            {eliminando ? 'Eliminando…' : 'Eliminar cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
