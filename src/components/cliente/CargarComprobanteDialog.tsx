import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, FilePlus2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ApiError } from '@/services/apiClient';
import { crearComprobanteManual } from '@/services/comprobantesService';
import type { Cliente } from '@/types';

type Direccion = 'emitido' | 'recibido';

// Catálogo completo de tipos de comprobante (espejo de TIPO_COMPROBANTE en backend/app/schemas.py:
// mantener en sync). Se ofrecen todos para ventas y compras — la app soporta clientes de cualquier
// régimen (monotributo clase C, responsable inscripto clase A/B, etc.). Los más habituales, primero.
const TIPOS_COMPROBANTE: { value: number; label: string }[] = [
  { value: 11, label: 'Factura C' },
  { value: 13, label: 'Nota de Crédito C' },
  { value: 12, label: 'Nota de Débito C' },
  { value: 15, label: 'Recibo C' },
  { value: 1, label: 'Factura A' },
  { value: 3, label: 'Nota de Crédito A' },
  { value: 2, label: 'Nota de Débito A' },
  { value: 4, label: 'Recibo A' },
  { value: 6, label: 'Factura B' },
  { value: 8, label: 'Nota de Crédito B' },
  { value: 7, label: 'Nota de Débito B' },
  { value: 9, label: 'Recibo B' },
  { value: 51, label: 'Factura M' },
  { value: 53, label: 'Nota de Crédito M' },
  { value: 52, label: 'Nota de Débito M' },
  { value: 54, label: 'Recibo M' },
  { value: 19, label: 'Factura E' },
  { value: 21, label: 'Nota de Crédito E' },
  { value: 20, label: 'Nota de Débito E' },
  { value: 211, label: 'Factura de Crédito MiPyME C (FCE)' },
  { value: 213, label: 'Nota de Crédito MiPyME C (FCE)' },
  { value: 212, label: 'Nota de Débito MiPyME C (FCE)' },
  { value: 201, label: 'Factura de Crédito MiPyME A (FCE)' },
  { value: 203, label: 'Nota de Crédito MiPyME A (FCE)' },
  { value: 202, label: 'Nota de Débito MiPyME A (FCE)' },
  { value: 206, label: 'Factura de Crédito MiPyME B (FCE)' },
  { value: 208, label: 'Nota de Crédito MiPyME B (FCE)' },
  { value: 207, label: 'Nota de Débito MiPyME B (FCE)' },
  { value: 83, label: 'Tique' },
  { value: 111, label: 'Tique Factura C' },
  { value: 81, label: 'Tique Factura A' },
  { value: 82, label: 'Tique Factura B' },
  { value: 114, label: 'Tique Nota de Crédito C' },
  { value: 112, label: 'Tique Nota de Crédito A' },
  { value: 113, label: 'Tique Nota de Crédito B' },
  { value: 117, label: 'Tique Nota de Débito C' },
  { value: 115, label: 'Tique Nota de Débito A' },
  { value: 116, label: 'Tique Nota de Débito B' },
];

interface Props {
  cliente: Cliente;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras guardar OK (para refrescar el cliente y que aparezca el comprobante). */
  onGuardado?: () => void;
}

export function CargarComprobanteDialog({ cliente, open, onOpenChange, onGuardado }: Props) {
  const [direccion, setDireccion] = useState<Direccion>('emitido');
  const [cbteTipo, setCbteTipo] = useState(11);
  const [fecha, setFecha] = useState('');
  const [puntoVenta, setPuntoVenta] = useState('');
  const [numero, setNumero] = useState('');
  const [importe, setImporte] = useState('');
  const [contraNombre, setContraNombre] = useState('');
  const [contraCuit, setContraCuit] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Reset al abrir. La fecha arranca en hoy (la fecha real del navegador).
  useEffect(() => {
    if (!open) return;
    const hoy = new Date();
    const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    setDireccion('emitido');
    setCbteTipo(11);
    setFecha(iso);
    setPuntoVenta('');
    setNumero('');
    setImporte('');
    setContraNombre('');
    setContraCuit('');
    setGuardando(false);
    setError('');
  }, [open]);

  const importeNum = Number(importe.replace(/\./g, '').replace(',', '.'));
  const numeroNum = Number(numero.replace(/\D/g, ''));
  const formOk = importeNum > 0 && numeroNum > 0 && !!fecha;
  const esVenta = direccion === 'emitido';

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      await crearComprobanteManual(cliente.cuit, {
        direccion,
        cbte_tipo: cbteTipo,
        fecha,
        punto_venta: Number(puntoVenta.replace(/\D/g, '')) || 0,
        numero: numeroNum,
        importe_total: importeNum,
        contraparte_nombre: contraNombre.trim(),
        contraparte_cuit: contraCuit.replace(/\D/g, ''),
      });
      onGuardado?.();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('Ya cargaste un comprobante con ese tipo, punto de venta y número.');
      } else {
        setError('No se pudo guardar el comprobante. Revisá los datos e intentá de nuevo.');
      }
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !guardando && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5 text-primary" />
            <DialogTitle>Cargar comprobante a mano</DialogTitle>
          </div>
          <DialogDescription>
            Para {cliente.nombre}. Sumá una venta o un gasto que no figura entre sus comprobantes
            (por ejemplo una factura de talonario en papel o un ticket).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de movimiento</Label>
              <Select value={direccion} onValueChange={v => setDireccion(v as Direccion)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="emitido">Venta (suma al facturado)</SelectItem>
                  <SelectItem value="recibido">Compra o gasto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Comprobante</Label>
              <Select value={String(cbteTipo)} onValueChange={v => setCbteTipo(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_COMPROBANTE.map(t => (
                    <SelectItem key={t.value} value={String(t.value)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm-fecha">Fecha</Label>
              <Input
                id="cm-fecha"
                type="date"
                value={fecha}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => setFecha(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-importe">Importe total</Label>
              <Input
                id="cm-importe"
                inputMode="decimal"
                placeholder="0"
                value={importe}
                onChange={e => setImporte(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm-pv">Punto de venta</Label>
              <Input
                id="cm-pv"
                inputMode="numeric"
                placeholder="0"
                value={puntoVenta}
                onChange={e => setPuntoVenta(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-numero">Número</Label>
              <Input
                id="cm-numero"
                inputMode="numeric"
                placeholder="Número del comprobante"
                value={numero}
                onChange={e => setNumero(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-contra">{esVenta ? 'Cliente' : 'Proveedor'} (opcional)</Label>
            <Input
              id="cm-contra"
              placeholder="Nombre o razón social"
              value={contraNombre}
              onChange={e => setContraNombre(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-contracuit">CUIT {esVenta ? 'del cliente' : 'del proveedor'} (opcional)</Label>
            <Input
              id="cm-contracuit"
              inputMode="numeric"
              placeholder="11 dígitos"
              value={contraCuit}
              onChange={e => setContraCuit(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button disabled={!formOk || guardando} onClick={guardar}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar comprobante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
