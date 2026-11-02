import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, FilePlus2, Plus, X } from 'lucide-react';
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
import { formatCurrency, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

type Direccion = 'emitido' | 'recibido';
type Tipo = { value: number; label: string };

// Catálogo completo de tipos de comprobante (espejo de TIPO_COMPROBANTE en backend/app/schemas.py:
// mantener en sync). Se ofrecen todos para ventas y compras — la app soporta clientes de cualquier
// régimen (monotributo clase C, responsable inscripto clase A/B, etc.). El orden depende del régimen.
const TIPOS_C: Tipo[] = [
  { value: 11, label: 'Factura C' },
  { value: 13, label: 'Nota de Crédito C' },
  { value: 12, label: 'Nota de Débito C' },
  { value: 15, label: 'Recibo C' },
];
const TIPOS_A_B: Tipo[] = [
  { value: 1, label: 'Factura A' },
  { value: 3, label: 'Nota de Crédito A' },
  { value: 2, label: 'Nota de Débito A' },
  { value: 4, label: 'Recibo A' },
  { value: 6, label: 'Factura B' },
  { value: 8, label: 'Nota de Crédito B' },
  { value: 7, label: 'Nota de Débito B' },
  { value: 9, label: 'Recibo B' },
];
const TIPOS_OTRO: Tipo[] = [
  { value: 99, label: '099 · Otro comprobante que no cumple la RG 1415' },
  { value: 90, label: '090 · Nota de Crédito de otro comprobante (no RG 1415)' },
];
const TIPOS_RESTO: Tipo[] = [
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
  { value: 109, label: 'Tique C (controlador fiscal anterior)' },
  { value: 110, label: 'Tique Nota de Crédito (controlador fiscal anterior)' },
];

// Clase C (no discrimina IVA): espejo de TIPOS_MONOTRIBUTO del backend.
const CLASE_C = new Set([11, 12, 13, 15, 211, 212, 213, 109, 110, 111, 114, 117]);
// Clase B: en compras no da crédito fiscal, así que alcanza con el total.
const CLASE_B = new Set([6, 7, 8, 9, 206, 207, 208, 82, 113, 116]);
// A, M y E van uno por uno (no se cargan por rango).
const SIN_RANGO = new Set([1, 2, 3, 4, 51, 52, 53, 54, 19, 20, 21, 201, 202, 203, 81, 112, 115]);

const ALICUOTAS = [21, 10.5, 27, 5, 2.5, 0];
// Cómo se reparte el total: una alícuota, todo exento, todo no gravado, o varias alícuotas a mano.
type ModoIva = `${number}` | 'exento' | 'no_gravado' | 'varias';
type FilaAlicuota = { alicuota: number; base: string };

const aNumero = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

function hoyIso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

interface Props {
  cliente: Cliente;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama tras guardar OK (para refrescar y que aparezca el comprobante), con su fecha. */
  onGuardado?: (fecha: string) => void;
  /** Valores con los que abre (p. ej. desde el Libro IVA: el lado y el período que se está viendo). */
  direccionInicial?: Direccion;
  tipoInicial?: number;
  fechaInicial?: string;
}

export function CargarComprobanteDialog({
  cliente,
  open,
  onOpenChange,
  onGuardado,
  direccionInicial,
  tipoInicial,
  fechaInicial,
}: Props) {
  const esMonotributo = cliente.regimen === 'monotributo';
  const tipos = esMonotributo
    ? [...TIPOS_C, ...TIPOS_A_B, ...TIPOS_OTRO, ...TIPOS_RESTO]
    : [...TIPOS_A_B, ...TIPOS_OTRO, ...TIPOS_C, ...TIPOS_RESTO];

  const [direccion, setDireccion] = useState<Direccion>('emitido');
  const [cbteTipo, setCbteTipo] = useState(11);
  const [fecha, setFecha] = useState('');
  const [puntoVenta, setPuntoVenta] = useState('');
  const [numero, setNumero] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [numeroHasta, setNumeroHasta] = useState('');
  const [importe, setImporte] = useState('');
  const [modoIva, setModoIva] = useState<ModoIva>('21');
  const [filas, setFilas] = useState<FilaAlicuota[]>([]);
  const [noGravado, setNoGravado] = useState('');
  const [exento, setExento] = useState('');
  const [contraNombre, setContraNombre] = useState('');
  const [contraCuit, setContraCuit] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  // Reset al abrir. La fecha arranca en la inicial o en hoy (la fecha real del navegador).
  useEffect(() => {
    if (!open) return;
    setDireccion(direccionInicial ?? 'emitido');
    setCbteTipo(tipoInicial ?? (esMonotributo ? 11 : 1));
    setFecha(fechaInicial ?? hoyIso());
    setPuntoVenta('');
    setNumero('');
    setMultiple(false);
    setNumeroHasta('');
    setImporte('');
    setModoIva('21');
    setFilas([
      { alicuota: 21, base: '' },
      { alicuota: 10.5, base: '' },
    ]);
    setNoGravado('');
    setExento('');
    setContraNombre('');
    setContraCuit('');
    setGuardando(false);
    setError('');
  }, [open, direccionInicial, tipoInicial, fechaInicial, esMonotributo]);

  const esVenta = direccion === 'emitido';
  // El desglose de IVA sólo tiene sentido para quien liquida IVA, en comprobantes que lo discriminan
  // (y en compras, sólo los que dan crédito fiscal).
  const conDesglose =
    !esMonotributo && !CLASE_C.has(cbteTipo) && !(direccion === 'recibido' && CLASE_B.has(cbteTipo));
  const rangoPermitido = esVenta && !SIN_RANGO.has(cbteTipo);
  const esRango = rangoPermitido && multiple;
  const varias = conDesglose && modoIva === 'varias';

  // Varias alícuotas: el total sale de la suma (base + IVA de cada fila + no gravado + exento).
  const filasNum = filas.map(f => {
    const base = r2(aNumero(f.base));
    return { alicuota: f.alicuota, base, iva: r2((base * f.alicuota) / 100) };
  });
  const totalVarias = r2(
    filasNum.reduce((s, f) => s + f.base + f.iva, 0) + aNumero(noGravado) + aNumero(exento)
  );
  const importeNum = varias ? totalVarias : aNumero(importe);

  // Una alícuota: neto e IVA salen del total (el IVA se redondea como lo calcula el backend).
  const tasa = Number(modoIva);
  const netoUna = !varias && !Number.isNaN(tasa) ? r2(importeNum / (1 + tasa / 100)) : 0;
  const ivaUna = !varias && !Number.isNaN(tasa) ? r2((netoUna * tasa) / 100) : 0;

  const numeroNum = Number(numero.replace(/\D/g, ''));
  const numeroHastaNum = Number(numeroHasta.replace(/\D/g, ''));
  const rangoOk = !esRango || numeroHastaNum >= numeroNum;
  const formOk = importeNum > 0 && numeroNum > 0 && !!fecha && rangoOk;

  function desglose() {
    if (!conDesglose) return {};
    if (modoIva === 'exento') return { alicuotas: [], imp_exento: importeNum };
    if (modoIva === 'no_gravado') return { alicuotas: [], imp_no_gravado: importeNum };
    if (modoIva === 'varias') {
      return {
        alicuotas: filasNum.filter(f => f.base > 0).map(f => ({ alicuota: f.alicuota, base: f.base })),
        imp_no_gravado: r2(aNumero(noGravado)),
        imp_exento: r2(aNumero(exento)),
      };
    }
    return { alicuotas: [{ alicuota: tasa, base: netoUna }] };
  }

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
        numero_hasta: esRango ? numeroHastaNum : null,
        importe_total: importeNum,
        contraparte_nombre: contraNombre.trim(),
        contraparte_cuit: contraCuit.replace(/\D/g, ''),
        ...desglose(),
      });
      onGuardado?.(fecha);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5 text-primary" />
            <DialogTitle>Cargar comprobante a mano</DialogTitle>
          </div>
          <DialogDescription>
            Para {cliente.nombre.replace(/\.$/, '')}. Sumá una venta o un gasto que no figura entre sus comprobantes
            (por ejemplo una factura de talonario en papel, un ticket o un 099).
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
              <Label htmlFor="cm-fecha">Fecha</Label>
              <Input
                id="cm-fecha"
                type="date"
                value={fecha}
                max={hoyIso()}
                onChange={e => setFecha(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Comprobante</Label>
            <Select value={String(cbteTipo)} onValueChange={v => setCbteTipo(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tipos.map(t => (
                  <SelectItem key={t.value} value={String(t.value)}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="cm-numero">{esRango ? 'Desde' : 'Número'}</Label>
                {rangoPermitido && (
                  <div className="flex rounded-md border text-[11px]">
                    {(['individual', 'múltiple'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMultiple(m === 'múltiple')}
                        className={cn(
                          'px-2 py-0.5 first:rounded-l-md last:rounded-r-md',
                          (m === 'múltiple') === multiple
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Input
                id="cm-numero"
                inputMode="numeric"
                placeholder="Número del comprobante"
                value={numero}
                onChange={e => setNumero(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          {esRango && (
            <div className="grid grid-cols-2 gap-3">
              <p className="self-end pb-2 text-xs text-muted-foreground">
                Un solo renglón para todos los comprobantes del rango, con el importe sumado.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="cm-hasta">Hasta</Label>
                <Input
                  id="cm-hasta"
                  inputMode="numeric"
                  placeholder="Último número"
                  value={numeroHasta}
                  onChange={e => setNumeroHasta(e.target.value.replace(/\D/g, ''))}
                  className={cn(!rangoOk && numeroHasta && 'border-danger')}
                />
              </div>
            </div>
          )}

          <div className={cn('grid gap-3', conDesglose && 'grid-cols-2')}>
            {conDesglose && (
              <div className="space-y-1.5">
                <Label>IVA</Label>
                <Select value={modoIva} onValueChange={v => setModoIva(v as ModoIva)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALICUOTAS.map(a => (
                      <SelectItem key={a} value={String(a)}>
                        {String(a).replace('.', ',')}%
                      </SelectItem>
                    ))}
                    <SelectItem value="exento">Exento</SelectItem>
                    <SelectItem value="no_gravado">No gravado</SelectItem>
                    <SelectItem value="varias">Varias alícuotas…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cm-importe">Importe total</Label>
              <Input
                id="cm-importe"
                inputMode="decimal"
                placeholder="0"
                value={varias ? formatCurrency(totalVarias) : importe}
                disabled={varias}
                onChange={e => setImporte(e.target.value)}
              />
            </div>
          </div>

          {conDesglose && !varias && importeNum > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {modoIva === 'exento'
                ? `Exento ${formatCurrency(importeNum)}`
                : modoIva === 'no_gravado'
                  ? `No gravado ${formatCurrency(importeNum)}`
                  : `Neto ${formatCurrency(netoUna)} + IVA ${formatCurrency(ivaUna)}`}
            </p>
          )}

          {varias && (
            <div className="space-y-2 rounded-lg border p-3">
              {filas.map((f, i) => (
                <div key={i} className="grid grid-cols-[6rem_1fr_auto_auto] items-center gap-2">
                  <Select
                    value={String(f.alicuota)}
                    onValueChange={v =>
                      setFilas(fs => fs.map((x, j) => (j === i ? { ...x, alicuota: Number(v) } : x)))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALICUOTAS.map(a => (
                        <SelectItem key={a} value={String(a)}>
                          {String(a).replace('.', ',')}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-9"
                    inputMode="decimal"
                    placeholder="Neto gravado"
                    value={f.base}
                    onChange={e =>
                      setFilas(fs => fs.map((x, j) => (j === i ? { ...x, base: e.target.value } : x)))
                    }
                  />
                  <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                    IVA {formatCurrency(filasNum[i].iva)}
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={filas.length === 1}
                    onClick={() => setFilas(fs => fs.filter((_, j) => j !== i))}
                    aria-label="Quitar alícuota"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilas(fs => [...fs, { alicuota: 21, base: '' }])}
              >
                <Plus className="h-4 w-4" />
                Otra alícuota
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cm-nograv">No gravado</Label>
                  <Input
                    id="cm-nograv"
                    inputMode="decimal"
                    placeholder="0"
                    value={noGravado}
                    onChange={e => setNoGravado(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cm-exento">Exento</Label>
                  <Input
                    id="cm-exento"
                    inputMode="decimal"
                    placeholder="0"
                    value={exento}
                    onChange={e => setExento(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

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
