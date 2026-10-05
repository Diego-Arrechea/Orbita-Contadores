import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Mail, SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useConfig } from '@/context/ConfigContext';
import { cuentaActual, tienePermiso } from '@/lib/cuenta';
import { armarDatosReporte, opcionesReporte } from '@/lib/reporteDatos';
import { armarMailReporte } from '@/lib/reporteMail';
import { editarCliente, enviarReporteCliente } from '@/services/clientesService';
import { getMovimientos } from '@/services/movimientosService';
import { mensajeDeError } from '@/services/authService';
import { formatDate } from '@/lib/utils';
import type { Cliente, MovimientoBancario } from '@/types';

const SECCIONES: { key: 'situacion' | 'historial' | 'alertas' | 'movimientos' | 'acciones'; label: string }[] = [
  { key: 'situacion', label: 'situación' },
  { key: 'historial', label: 'historial' },
  { key: 'alertas', label: 'alertas' },
  { key: 'movimientos', label: 'movimientos pendientes' },
  { key: 'acciones', label: 'acciones sugeridas' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Envía el reporte del cliente por mail (pedido de los contadores, reunión 1-oct-2026). Usa las
 * opciones de reporte del cliente (o las generales del estudio) y los mismos números que la pantalla
 * del reporte. El cliente puede responderle directo al contador.
 */
export function EnviarReporteDialog({
  cliente,
  open,
  onOpenChange,
  mensajeInicial = '',
}: {
  cliente: Cliente;
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  /** Mensaje precargado (p. ej. las observaciones que el contador ya escribió en el reporte). */
  mensajeInicial?: string;
}) {
  const { config, inflacionEfectiva } = useConfig();
  const qc = useQueryClient();
  const cuenta = cuentaActual();
  const rep = useMemo(
    () => opcionesReporte(config.reporte, cliente.reporteConfig),
    [config.reporte, cliente.reporteConfig],
  );

  const [destino, setDestino] = useState('');
  const [guardarMail, setGuardarMail] = useState(false);
  const [copiaAMi, setCopiaAMi] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [asunto, setAsunto] = useState('');
  const [movimientos, setMovimientos] = useState<MovimientoBancario[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviadoA, setEnviadoA] = useState<string | null>(null);

  // Al abrir: precarga destino/mensaje y trae los movimientos (para la sección de pendientes).
  useEffect(() => {
    if (!open) return;
    setDestino(cliente.emailCliente ?? '');
    setGuardarMail(false);
    setCopiaAMi(true);
    setMensaje(mensajeInicial);
    setError(null);
    setEnviadoA(null);
    setAsunto('');
    if (cliente.fuente === 'arca') {
      setMovimientos(null);
      getMovimientos(cliente.cuit)
        .then(setMovimientos)
        .catch(() => setMovimientos([]));
    } else {
      setMovimientos(cliente.movimientosBancarios ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cliente.cuit]);

  const mail = useMemo(() => {
    if (movimientos === null) return null;
    const datos = armarDatosReporte(cliente, config, inflacionEfectiva, movimientos, rep);
    return armarMailReporte({
      cliente,
      datos,
      rep,
      observaciones: mensaje,
      estudio: cuenta?.estudio || 'Tu estudio contable',
    });
  }, [cliente, config, inflacionEfectiva, movimientos, rep, mensaje, cuenta?.estudio]);

  const destinoLimpio = destino.trim();
  const destinoValido = EMAIL_RE.test(destinoLimpio);
  const mailNuevo = destinoValido && destinoLimpio.toLowerCase() !== (cliente.emailCliente ?? '').toLowerCase();
  const puedeGuardarMail = mailNuevo && cliente.fuente === 'arca' && tienePermiso('editar_cliente');
  const incluye = SECCIONES.filter(s => rep.secciones[s.key]).map(s => s.label);

  async function enviar() {
    if (!mail || !destinoValido) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await enviarReporteCliente(cliente.cuit, {
        destino: destinoLimpio,
        copiaAMi,
        asunto: asunto.trim() || mail.asunto,
        html: mail.html,
        texto: mail.texto,
      });
      if (puedeGuardarMail && guardarMail) {
        try {
          await editarCliente(cliente.cuit, { emailCliente: destinoLimpio });
        } catch {
          /* el envío ya salió: no guardar el mail no es motivo para mostrar error */
        }
      }
      setEnviadoA(r.destino);
      void qc.invalidateQueries({ queryKey: ['cliente', cliente.cuit] });
      void qc.invalidateQueries({ queryKey: ['clientes'] });
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar reporte por mail</DialogTitle>
          <DialogDescription>
            {cliente.nombre}. Le llega el reporte en el cuerpo del mail y, si responde, te escribe a vos.
          </DialogDescription>
        </DialogHeader>

        {enviadoA ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
              <Check className="h-5 w-5" />
            </div>
            <div className="font-medium">Reporte enviado</div>
            <div className="text-sm text-muted-foreground">
              Se lo mandamos a {enviadoA}
              {copiaAMi && cuenta?.email ? ` con copia a ${cuenta.email}` : ''}.
            </div>
            <Button className="mt-3" onClick={() => onOpenChange(false)}>
              Listo
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Para</label>
                <Input
                  type="email"
                  value={destino}
                  onChange={e => setDestino(e.target.value)}
                  placeholder="mail del cliente"
                  className="mt-1"
                />
                {!cliente.emailCliente && !destinoLimpio && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Este cliente no tiene mail cargado. Escribilo acá.
                  </p>
                )}
                {destinoLimpio && !destinoValido && (
                  <p className="mt-1 text-[11px] text-danger">Revisá el mail: no parece válido.</p>
                )}
                {puedeGuardarMail && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={guardarMail}
                      onChange={e => setGuardarMail(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                    />
                    Guardarlo como mail del cliente
                  </label>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Asunto</label>
                <Input
                  value={asunto}
                  onChange={e => setAsunto(e.target.value)}
                  placeholder={mail?.asunto ?? 'Reporte'}
                  maxLength={200}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Mensaje (opcional, va arriba del reporte)</label>
                <Textarea
                  value={mensaje}
                  onChange={e => setMensaje(e.target.value)}
                  placeholder="Ej.: Te paso cómo venís este mes. Ojo con el tope de la categoría."
                  rows={3}
                  className="mt-1"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copiaAMi}
                  onChange={e => setCopiaAMi(e.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                Mandarme una copia{cuenta?.email ? ` (${cuenta.email})` : ''}
              </label>

              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <div>
                  Incluye: {incluye.length ? incluye.join(', ') : 'sólo los datos del cliente'}
                  {rep.secciones.historial ? ` (${rep.mesesHistorial} meses)` : ''}.
                </div>
                <Link
                  to={`/clientes/${cliente.id}/reporte`}
                  onClick={() => onOpenChange(false)}
                  className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  Ver y personalizar el reporte
                </Link>
                {cliente.reporteEnviadoEn && (
                  <div className="mt-1">
                    Último envío: {formatDate(cliente.reporteEnviadoEn)}
                    {cliente.reporteEnviadoA ? ` a ${cliente.reporteEnviadoA}` : ''}.
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button onClick={enviar} disabled={enviando || !destinoValido || !mail}>
                {enviando || !mail ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Enviar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
