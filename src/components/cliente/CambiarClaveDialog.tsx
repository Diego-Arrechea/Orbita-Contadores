import { useState, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
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
import { actualizarClaveFiscal, getClaveGuardada } from '@/services/clientesService';
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

  // Clave GUARDADA (la que dejó de funcionar). Sólo se pide y se muestra cuando el cliente tiene un
  // problema de clave (el backend, además, sólo la entrega en ese caso). Sirve de referencia para
  // cargar la nueva. Se limpia al cerrar para no dejarla en memoria/estado.
  const enError = Boolean(cliente.claveInvalida || cliente.claveRequiereCambio);
  const [claveGuardada, setClaveGuardada] = useState<string | null>(null);
  const [cargandoGuardada, setCargandoGuardada] = useState(false);
  const [mostrarGuardada, setMostrarGuardada] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!open || !enError) return;
    let vivo = true;
    setCargandoGuardada(true);
    getClaveGuardada(cliente.cuit)
      .then(c => vivo && setClaveGuardada(c))
      .catch(() => vivo && setClaveGuardada(null))
      .finally(() => vivo && setCargandoGuardada(false));
    return () => {
      vivo = false;
    };
  }, [open, enError, cliente.cuit]);

  const cerrar = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      // Al cerrar, limpiá todo para no dejar claves (tipeada ni guardada) en memoria/estado.
      setClave('');
      setMostrar(false);
      setError('');
      setClaveGuardada(null);
      setMostrarGuardada(false);
      setCopiado(false);
    }
  };

  const copiar = async () => {
    if (!claveGuardada) return;
    try {
      await navigator.clipboard.writeText(claveGuardada);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // portapapeles no disponible: no hacemos nada
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

        {enError && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Clave que tenías guardada</div>
            {cargandoGuardada ? (
              <div className="text-sm text-muted-foreground">Cargando…</div>
            ) : claveGuardada != null ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded bg-card px-2 py-1 text-sm">
                  {mostrarGuardada ? claveGuardada || '—' : '•'.repeat(Math.min(claveGuardada.length || 6, 12))}
                </code>
                <button
                  type="button"
                  onClick={() => setMostrarGuardada(v => !v)}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-md"
                  aria-label={mostrarGuardada ? 'Ocultar clave guardada' : 'Mostrar clave guardada'}
                >
                  {mostrarGuardada ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={copiar}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-md"
                  aria-label="Copiar clave guardada"
                >
                  {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No se pudo obtener la clave guardada.</div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Es la que estaba cargada y dejó de funcionar. Usala de referencia para cargar la nueva.
            </p>
          </div>
        )}

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
            Queda guardada de forma cifrada. Al guardarla, volvemos a traer su información enseguida.
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
