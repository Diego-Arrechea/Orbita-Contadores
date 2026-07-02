import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { actualizarClaveFiscal } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import type { Cliente } from '@/types';

/** Diálogo para reemplazar la clave fiscal guardada de un cliente (cuando la cambia en ARCA).
 *  Controlado desde el menú de la ficha (open/onOpenChange). */
export function CambiarClaveDialog({
  cliente,
  onGuardado,
  open,
  onOpenChange,
}: {
  cliente: Cliente;
  onGuardado: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [clave, setClave] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const cerrar = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      // Al cerrar, limpiá el formulario para no dejar la clave tipeada en memoria/estado.
      setClave('');
      setMostrar(false);
      setError('');
    }
  };

  const guardar = async () => {
    const limpia = clave.trim();
    if (!limpia) {
      setError('Ingresá la nueva clave fiscal.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await actualizarClaveFiscal(cliente.cuit, limpia);
      cerrar(false);
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Actualizar clave fiscal</DialogTitle>
          <DialogDescription>
            Si {cliente.nombre} cambió su clave fiscal, actualizala acá para que su información se
            siga manteniendo al día.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          <Label htmlFor="cc-clave">Nueva clave fiscal</Label>
          <div className="relative">
            <Input
              id="cc-clave"
              name="clave-arca"
              value={clave}
              onChange={e => setClave(e.target.value)}
              type={mostrar ? 'text' : 'password'}
              placeholder="••••••••"
              className="pr-10"
              autoComplete="new-password"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !guardando) void guardar();
              }}
            />
            <button
              type="button"
              onClick={() => setMostrar(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground rounded-md"
              aria-label={mostrar ? 'Ocultar clave' : 'Mostrar clave'}
            >
              {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Queda guardada de forma cifrada.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={guardar} disabled={!clave.trim() || guardando}>
            {guardando ? 'Guardando…' : 'Guardar clave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
