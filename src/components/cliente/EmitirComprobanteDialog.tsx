import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
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
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  getContextoFacturacion,
  facturar,
  mensajeErrorFacturacion,
  type FacturarPayload,
  type ComprobanteEmitidoResp,
} from '@/services/facturacionService';
import type { Cliente } from '@/types';

/** Condición frente al IVA del receptor (RG 5616) → código + tipo de documento asociado. */
const CONDICIONES = [
  { value: 5, label: 'Consumidor final', docTipo: 99, requiereCuit: false },
  { value: 1, label: 'Responsable inscripto', docTipo: 80, requiereCuit: true },
  { value: 6, label: 'Monotributo', docTipo: 80, requiereCuit: true },
  { value: 4, label: 'Exento', docTipo: 80, requiereCuit: true },
];

const CONCEPTOS = [
  { value: 1, label: 'Productos' },
  { value: 2, label: 'Servicios' },
  { value: 3, label: 'Productos y servicios' },
];

function nombreComprobante(cbteTipo: number): string {
  return cbteTipo === 13 ? 'Nota de Crédito C' : 'Factura C';
}

type Paso = 'form' | 'confirm' | 'emitiendo' | 'ok';

interface Props {
  cliente: Cliente;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill opcional (p. ej. al facturar desde un movimiento sin respaldo). */
  prefill?: { importe?: number };
  /** Se llama tras emitir OK (para refrescar el cliente y que aparezca el comprobante). */
  onEmitido?: () => void;
}

export function EmitirComprobanteDialog({ cliente, open, onOpenChange, prefill, onEmitido }: Props) {
  const [paso, setPaso] = useState<Paso>('form');
  const [tipo, setTipo] = useState<'factura' | 'nc'>('factura');
  const [concepto, setConcepto] = useState(1);
  const [condicion, setCondicion] = useState(5);
  const [cuitReceptor, setCuitReceptor] = useState('');
  const [importe, setImporte] = useState('');
  const [puntoVenta, setPuntoVenta] = useState('1');
  const [ncPv, setNcPv] = useState('1');
  const [ncNumero, setNcNumero] = useState('');
  const [tieneCert, setTieneCert] = useState<boolean | null>(null);
  const [homo, setHomo] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<ComprobanteEmitidoResp | null>(null);

  // Reset al abrir + consulta si el cliente ya tiene certificado (para avisar la espera del bootstrap).
  useEffect(() => {
    if (!open) return;
    setPaso('form');
    setTipo('factura');
    setConcepto(1);
    setCondicion(5);
    setCuitReceptor('');
    setImporte(prefill?.importe ? String(Math.round(prefill.importe)) : '');
    setPuntoVenta('1');
    setNcPv('1');
    setNcNumero('');
    setError('');
    setResultado(null);
    setTieneCert(null);
    setHomo(false);
    getContextoFacturacion(cliente.cuit)
      .then(c => {
        setTieneCert(c.tiene_certificado);
        setHomo(c.homologacion);
      })
      .catch(() => setTieneCert(null));
  }, [open, cliente.cuit, prefill?.importe]);

  const cond = CONDICIONES.find(c => c.value === condicion)!;
  const importeNum = Number(importe.replace(/\./g, '').replace(',', '.'));
  const cuitDigits = cuitReceptor.replace(/\D/g, '');
  const formOk =
    importeNum > 0 &&
    (!cond.requiereCuit || cuitDigits.length === 11) &&
    (tipo === 'factura' || Number(ncNumero) > 0);

  const cerrar = (o: boolean) => {
    if (paso !== 'emitiendo') onOpenChange(o);
  };

  const emitir = async () => {
    setPaso('emitiendo');
    setError('');
    const payload: FacturarPayload = {
      cbte_tipo: tipo === 'factura' ? 11 : 13,
      importe_total: importeNum,
      punto_venta: Number(puntoVenta) || 1,
      concepto,
      doc_tipo: cond.docTipo,
      doc_nro: cond.requiereCuit ? cuitDigits : '0',
      condicion_iva_receptor: condicion,
      comprobante_asociado:
        tipo === 'nc'
          ? { tipo: 11, punto_venta: Number(ncPv) || 1, numero: Number(ncNumero) }
          : null,
    };
    try {
      const res = await facturar(cliente.cuit, payload);
      setResultado(res);
      setPaso('ok');
      onEmitido?.();
    } catch (e) {
      setError(mensajeErrorFacturacion(e));
      setPaso('confirm');
    }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent>
        {/* ── Formulario (borrador) ── */}
        {paso === 'form' && (
          <>
            <DialogHeader>
              <DialogTitle>Emitir comprobante</DialogTitle>
              <DialogDescription>
                A nombre de {cliente.nombre}. Se emite ante ARCA y queda asociado al cliente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={tipo} onValueChange={v => setTipo(v as 'factura' | 'nc')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Factura C</SelectItem>
                      <SelectItem value="nc">Nota de Crédito C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Concepto</Label>
                  <Select value={String(concepto)} onValueChange={v => setConcepto(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONCEPTOS.map(c => (
                        <SelectItem key={c.value} value={String(c.value)}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {tipo === 'nc' && (
                <div className="space-y-1.5">
                  <Label>Factura que corrige (Factura C)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      inputMode="numeric"
                      placeholder="Punto de venta"
                      value={ncPv}
                      onChange={e => setNcPv(e.target.value.replace(/\D/g, ''))}
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="Número"
                      value={ncNumero}
                      onChange={e => setNcNumero(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Condición del receptor</Label>
                <Select value={String(condicion)} onValueChange={v => setCondicion(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDICIONES.map(c => (
                      <SelectItem key={c.value} value={String(c.value)}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {cond.requiereCuit && (
                <div className="space-y-1.5">
                  <Label htmlFor="fc-cuit">CUIT del receptor</Label>
                  <Input
                    id="fc-cuit"
                    inputMode="numeric"
                    placeholder="11 dígitos"
                    value={cuitReceptor}
                    onChange={e => setCuitReceptor(e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fc-importe">Importe total</Label>
                  <Input
                    id="fc-importe"
                    inputMode="decimal"
                    placeholder="0"
                    value={importe}
                    onChange={e => setImporte(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fc-pv">Punto de venta</Label>
                  <Input
                    id="fc-pv"
                    inputMode="numeric"
                    value={puntoVenta}
                    onChange={e => setPuntoVenta(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button disabled={!formOk} onClick={() => setPaso('confirm')}>
                Revisar <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Confirmación ── */}
        {paso === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle>Revisá antes de emitir</DialogTitle>
              <DialogDescription>
                {homo
                  ? 'Entorno de PRUEBA: no se emite un comprobante real. Verificá los datos.'
                  : 'Esto emite un comprobante real ante ARCA. Verificá los datos.'}
              </DialogDescription>
            </DialogHeader>

            {homo && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/25 px-3 py-2 text-sm text-primary">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Modo prueba (homologación) — el comprobante no tiene validez fiscal.</span>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
              <Fila k="Comprobante" v={nombreComprobante(tipo === 'factura' ? 11 : 13)} />
              <Fila k="Emisor" v={cliente.nombre} />
              <Fila
                k="Receptor"
                v={cond.requiereCuit ? `${cond.label} · ${cuitReceptor}` : cond.label}
              />
              {tipo === 'nc' && <Fila k="Corrige" v={`${ncPv}-${ncNumero}`} />}
              <Fila k="Concepto" v={CONCEPTOS.find(c => c.value === concepto)?.label ?? ''} />
              <Fila k="Importe" v={formatCurrency(importeNum)} destacado />
            </div>

            {tieneCert === false && (
              <div className="flex items-start gap-2 rounded-lg bg-warning/15 border border-warning/30 px-3 py-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" />
                <span>
                  Es la primera emisión de este cliente: la habilitación inicial puede tardar cerca de
                  un minuto. Después es instantáneo.
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setPaso('form')}>
                Volver
              </Button>
              <Button onClick={emitir}>Emitir comprobante</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Emitiendo ── */}
        {paso === 'emitiendo' && (
          <div className="flex flex-col items-center text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="mt-4 font-medium">Emitiendo el comprobante…</div>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              {tieneCert === false
                ? 'Habilitando la facturación de este cliente (puede tardar ~1 minuto).'
                : 'Pidiendo el CAE a ARCA.'}
            </p>
          </div>
        )}

        {/* ── Resultado ── */}
        {paso === 'ok' && resultado && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <DialogTitle>Comprobante emitido</DialogTitle>
              </div>
              <DialogDescription>
                {nombreComprobante(resultado.cbte_tipo)}{' '}
                {resultado.punto_venta.toString().padStart(5, '0')}-
                {resultado.numero.toString().padStart(8, '0')}
                {resultado.homologacion ? ' · (homologación)' : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
              <Fila k="Importe" v={formatCurrency(resultado.importe_total)} destacado />
              <Fila k="CAE" v={resultado.cae} />
              <Fila k="Vencimiento del CAE" v={formatVto(resultado.cae_vto)} />
              <Fila k="Fecha" v={formatDate(resultado.fecha, 'long')} />
            </div>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fila({ k, v, destacado }: { k: string; v: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={destacado ? 'font-semibold tabular-nums' : 'font-medium text-right'}>{v}</span>
    </div>
  );
}

/** El CAE vto viene como 'yyyymmdd'. */
function formatVto(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return formatDate(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`, 'long');
  }
  return yyyymmdd || '—';
}
