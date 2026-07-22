/**
 * Vista previa del recordatorio de vencimiento de un cliente. Muestra el mail tal como le llegaría
 * al cliente final y, de paso, manda una copia a la casilla del contador (endpoint /prueba). Sólo
 * aparece para monotributistas con un próximo vencimiento cargado. El HTML se renderiza aislado en
 * un iframe (el contenido lo genera nuestro backend).
 */
import { useState } from 'react';
import { Mail, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { enviarPruebaVencimiento, type PruebaVencimiento } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import { esMonotributista } from '@/lib/regimen';
import type { Cliente } from '@/types';

export function VistaPreviaVencimiento({ cliente }: { cliente: Cliente }) {
  const [open, setOpen] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [prueba, setPrueba] = useState<PruebaVencimiento | null>(null);
  const [error, setError] = useState('');

  // Sólo tiene sentido para monotributistas reales con un próximo vencimiento conocido.
  if (cliente.fuente !== 'arca' || !esMonotributista(cliente) || !cliente.proxVencFecha) return null;

  const abrir = async () => {
    setOpen(true);
    setCargando(true);
    setPrueba(null);
    setError('');
    try {
      setPrueba(await enviarPruebaVencimiento(cliente.cuit));
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={abrir}>
        <Mail className="h-4 w-4" /> Vista previa del recordatorio
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recordatorio de vencimiento</DialogTitle>
            <DialogDescription>
              Así le llega el aviso a {cliente.nombre}. Te mandamos una copia a tu correo.
            </DialogDescription>
          </DialogHeader>

          {!cliente.emailCliente && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              Este cliente todavía no tiene un email cargado. Cargalo para que reciba el recordatorio.
            </div>
          )}

          {cargando && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparando la vista previa…
            </div>
          )}

          {error && <p className="py-4 text-sm text-danger">{error}</p>}

          {!cargando && prueba && (
            <div className="space-y-3">
              {prueba.html ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Asunto: <span className="text-foreground">{prueba.asunto}</span>
                  </div>
                  <Card className="overflow-hidden p-0">
                    <iframe
                      title="Vista previa del recordatorio"
                      srcDoc={prueba.html}
                      className="h-56 w-full border-0 bg-white"
                    />
                  </Card>
                  <p className="text-xs text-muted-foreground">
                    {prueba.enviado
                      ? `Te enviamos una copia a ${prueba.destino} para que veas cómo llega.`
                      : 'Así se ve el recordatorio (la copia de prueba a tu correo no pudo salir ahora).'}
                  </p>
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">{prueba.motivo}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
