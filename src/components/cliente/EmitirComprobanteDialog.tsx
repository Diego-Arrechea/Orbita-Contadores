import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, FileKey2, Store, Download } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  getContextoFacturacion,
  facturar,
  prepararFacturacion,
  progresoPreparacion,
  mensajeErrorFacturacion,
  esErrorSinPuntoVenta,
  descargarComprobantePdf,
  type FacturarPayload,
  type ComprobanteEmitidoResp,
  type PuntoVenta,
} from '@/services/facturacionService';
import { usePreparaciones } from '@/context/PreparacionesContext';
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

type Paso = 'cargando' | 'preparar' | 'preparando' | 'sin-pv' | 'form' | 'confirm' | 'emitiendo' | 'ok';

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
  const [paso, setPaso] = useState<Paso>('cargando');
  const [homo, setHomo] = useState(false);
  const [puntosVenta, setPuntosVenta] = useState<PuntoVenta[] | null>(null);
  const [pvSel, setPvSel] = useState<number | null>(null);
  const [progreso, setProgreso] = useState(0);
  const [mensajePrep, setMensajePrep] = useState('');

  const [tipo, setTipo] = useState<'factura' | 'nc'>('factura');
  const [concepto, setConcepto] = useState(1);
  const [condicion, setCondicion] = useState(5);
  const [cuitReceptor, setCuitReceptor] = useState('');
  const [importe, setImporte] = useState('');
  const [ncPv, setNcPv] = useState('');
  const [ncNumero, setNcNumero] = useState('');
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<ComprobanteEmitidoResp | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [prepJobId, setPrepJobId] = useState<string | null>(null);
  const { registrar } = usePreparaciones();

  const pollRef = useRef<number | null>(null);
  const pvAutoRef = useRef(false); // ya intentamos auto-crear el PV (evita loop con el tutorial)
  const detenerPoll = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  };

  // Lee el contexto y enruta al paso correcto (sin cert → preparar; sin PV → tutorial; listo → form).
  const cargarContexto = async () => {
    setPaso('cargando');
    setError('');
    try {
      const c = await getContextoFacturacion(cliente.cuit);
      setHomo(c.homologacion);
      if (!c.tiene_certificado) {
        setPaso('preparar');
        return;
      }
      if (Array.isArray(c.puntos_venta)) {
        if (c.puntos_venta.length === 0) {
          // El PV se crea SOLO (el job de preparación corre asegurar_punto_venta). Lo
          // disparamos una vez automáticamente; el tutorial manual queda de fallback por
          // si la creación no prosperó (así el contador no tiene que hacerlo a mano).
          if (!pvAutoRef.current) {
            pvAutoRef.current = true;
            void prepararCert();
            return;
          }
          setPaso('sin-pv');
          return;
        }
        setPuntosVenta(c.puntos_venta);
        setPvSel(c.puntos_venta[0].nro);
      } else {
        setPuntosVenta(null);
        setPvSel(null); // desconocido: el backend lo auto-detecta al emitir
      }
      setPaso('form');
    } catch {
      // Si no se pudo leer el contexto, dejamos intentar el form (el backend valida igual).
      setPuntosVenta(null);
      setPvSel(null);
      setPaso('form');
    }
  };

  useEffect(() => {
    if (!open) {
      detenerPoll();
      return;
    }
    // Reset de campos al abrir.
    setTipo('factura');
    setConcepto(1);
    setCondicion(5);
    setCuitReceptor('');
    setImporte(prefill?.importe ? String(Math.round(prefill.importe)) : '');
    setNcPv('');
    setNcNumero('');
    setError('');
    setResultado(null);
    setProgreso(0);
    setPrepJobId(null);
    pvAutoRef.current = false; // reintentar la auto-creación del PV en cada apertura
    void cargarContexto();
    return detenerPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cliente.cuit, prefill?.importe]);

  const cond = CONDICIONES.find(c => c.value === condicion)!;
  const importeNum = Number(importe.replace(/\./g, '').replace(',', '.'));
  const cuitDigits = cuitReceptor.replace(/\D/g, '');
  const formOk =
    importeNum > 0 &&
    (!cond.requiereCuit || cuitDigits.length === 11) &&
    (tipo === 'factura' || Number(ncNumero) > 0);

  const cerrar = (o: boolean) => {
    if (!o && paso === 'emitiendo') return; // una emisión en curso no se interrumpe
    if (!o && paso === 'preparando' && prepJobId) {
      // El job sigue corriendo en el backend: lo pasamos al indicador del header para seguirlo en
      // segundo plano. El contador cierra y sigue trabajando; al terminar, el botón pasa a "Emitir".
      detenerPoll();
      registrar(prepJobId, cliente.cuit, cliente.nombre, progreso, mensajePrep);
    }
    onOpenChange(o);
  };

  // ── Generar el certificado (job en segundo plano) ──
  const prepararCert = async () => {
    setPaso('preparando');
    setError('');
    setProgreso(5);
    setMensajePrep('Habilitando la facturación de este cliente…');
    try {
      const { job_id } = await prepararFacturacion(cliente.cuit);
      setPrepJobId(job_id);
      const poll = async () => {
        try {
          const j = await progresoPreparacion(cliente.cuit, job_id);
          setProgreso(j.progreso);
          setMensajePrep(j.mensaje);
          if (j.estado === 'terminado') {
            await cargarContexto();
            return;
          }
          if (j.estado === 'error') {
            setError(j.error || j.mensaje || 'No se pudo habilitar la facturación.');
            setPaso('preparar');
            return;
          }
          pollRef.current = window.setTimeout(poll, 2500);
        } catch (e) {
          setError(mensajeErrorFacturacion(e));
          setPaso('preparar');
        }
      };
      void poll();
    } catch (e) {
      setError(mensajeErrorFacturacion(e));
      setPaso('preparar');
    }
  };

  // ── Emitir ──
  const emitir = async () => {
    setPaso('emitiendo');
    setError('');
    const payload: FacturarPayload = {
      cbte_tipo: tipo === 'factura' ? 11 : 13,
      importe_total: importeNum,
      punto_venta: pvSel ?? undefined,
      concepto,
      doc_tipo: cond.docTipo,
      doc_nro: cond.requiereCuit ? cuitDigits : '0',
      condicion_iva_receptor: condicion,
      comprobante_asociado:
        tipo === 'nc'
          ? { tipo: 11, punto_venta: Number(ncPv) || pvSel || 0, numero: Number(ncNumero) }
          : null,
    };
    try {
      const res = await facturar(cliente.cuit, payload);
      setResultado(res);
      setPaso('ok');
      onEmitido?.();
    } catch (e) {
      if (esErrorSinPuntoVenta(e)) {
        setPaso('sin-pv');
        return;
      }
      setError(mensajeErrorFacturacion(e));
      setPaso('confirm');
    }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent>
        {/* ── Cargando contexto ── */}
        {paso === 'cargando' && (
          <div className="flex flex-col items-center py-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <div className="mt-3 text-sm text-muted-foreground">Cargando…</div>
          </div>
        )}

        {/* ── Habilitar facturación (generar cert) ── */}
        {paso === 'preparar' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <FileKey2 className="h-5 w-5 text-primary" />
                <DialogTitle>Habilitar facturación</DialogTitle>
              </div>
              <DialogDescription>
                Para emitir comprobantes de {cliente.nombre} hay que habilitar la facturación
                electrónica una vez. Es un proceso automático que puede tardar cerca de un minuto.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={prepararCert}>Habilitar</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Preparando (progreso del job) ── */}
        {paso === 'preparando' && (
          <div className="flex flex-col items-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="mt-4 font-medium">Habilitando la facturación…</div>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">{mensajePrep}</p>
            <div className="mt-4 w-full max-w-xs">
              <Progress value={progreso} className="h-1.5" />
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">{progreso}%</div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground max-w-xs">
              Podés cerrar esta ventana: sigue en segundo plano y te avisamos cuando esté lista.
            </p>
          </div>
        )}

        {/* ── Falta punto de venta Web Service (tutorial) ── */}
        {paso === 'sin-pv' && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-warning-foreground" />
                <DialogTitle>Falta el punto de venta</DialogTitle>
              </div>
              <DialogDescription>
                {cliente.nombre} todavía no tiene un punto de venta de facturación electrónica
                (Web Service). Se crea una sola vez en ARCA, con la clave del cliente:
              </DialogDescription>
            </DialogHeader>

            <ol className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm">
              <PasoTutorial n={1}>
                Entrá a ARCA con la clave fiscal del cliente y abrí el servicio{' '}
                <strong>“Administración de puntos de venta y domicilios”</strong>.
              </PasoTutorial>
              <PasoTutorial n={2}>
                Elegí al contribuyente → <strong>ABM Puntos de Venta</strong> →{' '}
                <strong>Agregar</strong>.
              </PasoTutorial>
              <PasoTutorial n={3}>
                En <strong>Sistema</strong> elegí{' '}
                <strong>“Factura Electrónica - Monotributo - Web Service”</strong> (el de Web
                Service, no el de “Comprobantes en línea”).
              </PasoTutorial>
              <PasoTutorial n={4}>Asociá el domicilio y confirmá.</PasoTutorial>
            </ol>
            <p className="text-xs text-muted-foreground">
              Cuando lo tengas, volvé acá y reintentá: la app lo detecta solo.
            </p>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
              <Button onClick={cargarContexto}>Ya lo creé, reintentar</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Formulario ── */}
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
                      placeholder={pvSel ? `Punto de venta (${pvSel})` : 'Punto de venta'}
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
                  <Label>Punto de venta</Label>
                  {puntosVenta && puntosVenta.length > 1 ? (
                    <Select
                      value={String(pvSel ?? '')}
                      onValueChange={v => setPvSel(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {puntosVenta.map(p => (
                          <SelectItem key={p.nro} value={String(p.nro)}>
                            {p.nro}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground">
                      {pvSel ?? 'automático'}
                    </div>
                  )}
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
              {tipo === 'nc' && <Fila k="Corrige" v={`${ncPv || pvSel}-${ncNumero}`} />}
              <Fila k="Concepto" v={CONCEPTOS.find(c => c.value === concepto)?.label ?? ''} />
              {pvSel != null && <Fila k="Punto de venta" v={String(pvSel)} />}
              <Fila k="Importe" v={formatCurrency(importeNum)} destacado />
            </div>

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
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">Pidiendo el CAE a ARCA.</p>
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

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
              <Button
                disabled={descargando}
                onClick={async () => {
                  setError('');
                  setDescargando(true);
                  try {
                    await descargarComprobantePdf(cliente.cuit, {
                      cbte_tipo: resultado.cbte_tipo,
                      punto_venta: resultado.punto_venta,
                      numero: resultado.numero,
                    });
                  } catch (e) {
                    setError(mensajeErrorFacturacion(e));
                  } finally {
                    setDescargando(false);
                  }
                }}
              >
                {descargando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Descargar comprobante
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PasoTutorial({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
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
