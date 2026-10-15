import { useEffect, useState } from 'react';
import { Check, Loader2, Mail } from 'lucide-react';
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
import { cuentaActual } from '@/lib/cuenta';
import { enviarComprobante, mensajeErrorFacturacion } from '@/services/facturacionService';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Comp = { cbte_tipo: number; punto_venta: number; numero: number };

export function nombreComprobante(cbteTipo: number): string {
  return cbteTipo === 13 ? 'Nota de Crédito C' : cbteTipo === 15 ? 'Recibo C' : 'Factura C';
}

export const numeroComprobante = (c: Comp) =>
  `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;

/** Casilla «Mandarme una copia (mail del contador)». */
export function CopiaAMi({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const cuenta = cuentaActual();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
      />
      Mandarme una copia{cuenta?.email ? ` (${cuenta.email})` : ''}
    </label>
  );
}

/**
 * Mail + «Enviar». Manda el comprobante (PDF adjunto) al receptor. Se usa en el paso final de la
 * emisión y desde la lista de comprobantes.
 */
export function EnviarComprobanteForm({
  cuit,
  comp,
  emailInicial = '',
  onEnviado,
}: {
  cuit: string;
  comp: Comp;
  emailInicial?: string;
  onEnviado?: (email: string) => void;
}) {
  const [email, setEmail] = useState(emailInicial);
  const [copia, setCopia] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [enviadoA, setEnviadoA] = useState('');

  const limpio = email.trim();
  const valido = EMAIL_RE.test(limpio);

  const enviar = async () => {
    setError('');
    setEnviando(true);
    try {
      await enviarComprobante(cuit, comp, { email: limpio, copia_a_mi: copia });
      setEnviadoA(limpio);
      onEnviado?.(limpio);
    } catch (e) {
      setError(mensajeErrorFacturacion(e));
    } finally {
      setEnviando(false);
    }
  };

  if (enviadoA) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 px-3 py-2.5 text-sm">
        <Check className="h-4 w-4 text-success shrink-0" />
        <span>
          Enviado a <strong>{enviadoA}</strong>.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="mail del cliente"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && valido && !enviando) void enviar();
          }}
        />
        <Button disabled={!valido || enviando} onClick={enviar} className="shrink-0">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Enviar
        </Button>
      </div>
      {limpio && !valido && <p className="text-[11px] text-danger">Revisá el mail: no parece válido.</p>}
      <CopiaAMi checked={copia} onChange={setCopia} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Diálogo para mandar por mail un comprobante ya emitido (desde la lista de comprobantes). */
export function EnviarComprobanteDialog({
  cuit,
  comp,
  emailInicial,
  open,
  onOpenChange,
  onEnviado,
}: {
  cuit: string;
  comp: Comp;
  emailInicial?: string | null;
  open: boolean;
  onOpenChange: (abierto: boolean) => void;
  onEnviado?: (email: string) => void;
}) {
  // Remonta el form en cada apertura (arranca limpio, con el último mail usado).
  const [clave, setClave] = useState(0);
  useEffect(() => {
    if (open) setClave(k => k + 1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar por mail</DialogTitle>
          <DialogDescription>
            {nombreComprobante(comp.cbte_tipo)} {numeroComprobante(comp)}. Le llega con el PDF adjunto.
          </DialogDescription>
        </DialogHeader>
        <EnviarComprobanteForm
          key={clave}
          cuit={cuit}
          comp={comp}
          emailInicial={emailInicial ?? ''}
          onEnviado={onEnviado}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
