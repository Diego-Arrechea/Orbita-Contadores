import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Link2,
  AlertCircle,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  X,
  Sparkles,
  ArrowRight,
  Plus,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { formatCurrency, formatDate, formatCuit, cn } from '@/lib/utils';
import type { Cliente, MovimientoBancario } from '@/types';
import {
  parsearArchivo,
  normalizarFilas,
  autoMapear,
  inferirFuente,
  type CampoDestino,
  type FuenteMovimiento,
  type ExtractoParseado,
} from '@/lib/parsearExtracto';
import {
  importarMovimientos,
  getMovimientos,
  clasificarMovimiento,
  reconciliarPendientes,
  type ImportarResumen,
} from '@/services/movimientosService';
import { DropZone, Stat, CONFIANZA_TONO } from '@/components/cliente/conciliacionShared';
import { VerDetalle } from '@/components/cliente/VerDetalle';
import { detalleConciliacion } from '@/lib/trazabilidad';
import { EmitirComprobanteDialog } from '@/components/cliente/EmitirComprobanteDialog';
import { puedeFacturar } from '@/lib/cuenta';

const TARGET_FIELDS: { value: CampoDestino; label: string }[] = [
  { value: 'fecha', label: 'Fecha del movimiento' },
  { value: 'descripcion', label: 'Descripción / Detalle' },
  { value: 'cuit', label: 'CUIT contraparte' },
  { value: 'monto', label: 'Monto (ARS)' },
  { value: 'saldo', label: 'Saldo posterior' },
  { value: 'ignorar', label: '— Ignorar columna —' },
];

const FUENTES: { value: FuenteMovimiento; label: string }[] = [
  { value: 'banco', label: 'Banco' },
  { value: 'mercadopago', label: 'MercadoPago' },
  { value: 'otro', label: 'Otra billetera / cuenta' },
];

interface Props {
  cliente: Cliente;
}

/**
 * Conciliación bancaria. Para clientes REALES (fuente 'arca') corre el flujo de verdad: parsea el
 * extracto, lo cruza con los comprobantes reales de ARCA en el backend y persiste el resultado.
 * Para los clientes mock (los seeds de la demo) mantiene la animación de demostración.
 */
export function ReconciliacionBancaria({ cliente }: Props) {
  if (cliente.fuente === 'arca') return <ReconciliacionReal cliente={cliente} />;
  return <ReconciliacionMock cliente={cliente} />;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FLUJO REAL (cliente 'arca'): parseo real + cruce real contra ARCA
   ═══════════════════════════════════════════════════════════════════════════ */

type RealStep = 'idle' | 'mapping' | 'importing' | 'done';

function ReconciliacionReal({ cliente }: Props) {
  const [movimientos, setMovimientos] = useState<MovimientoBancario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [clasificandoId, setClasificandoId] = useState<string | null>(null);
  const [facturarMov, setFacturarMov] = useState<MovimientoBancario | null>(null);
  const habilitadoFacturar = puedeFacturar();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<RealStep>('idle');
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [parseado, setParseado] = useState<ExtractoParseado | null>(null);
  const [mapping, setMapping] = useState<Record<string, CampoDestino>>({});
  const [fuente, setFuente] = useState<FuenteMovimiento>('banco');
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ImportarResumen | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const cargarMovimientos = useCallback(async () => {
    try {
      setMovimientos(await getMovimientos(cliente.cuit));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los movimientos.');
    } finally {
      setCargando(false);
    }
  }, [cliente.cuit]);

  useEffect(() => {
    void cargarMovimientos();
  }, [cargarMovimientos]);

  const openDialog = () => {
    setStep('idle');
    setFile(null);
    setParseado(null);
    setMapping({});
    setError(null);
    setOpen(true);
  };

  const onFile = useCallback(async (incoming: FileList | File[] | null) => {
    const f = incoming && incoming.length > 0 ? incoming[0] : null;
    if (!f) return;
    setError(null);
    try {
      const parsed = await parsearArchivo(f);
      if (parsed.columnas.length === 0 || parsed.filas.length === 0) {
        setError('No se pudieron leer columnas/filas del archivo. ¿Es un extracto tabular válido?');
        return;
      }
      setFile({ name: f.name, size: f.size });
      setParseado(parsed);
      setMapping(autoMapear(parsed.columnas));
      setFuente(inferirFuente(f.name));
      setStep('mapping');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo parsear el archivo.');
    }
  }, []);

  const confirmar = async () => {
    if (!parseado) return;
    const filas = normalizarFilas(parseado.filas, parseado.columnas, mapping);
    if (filas.length === 0) {
      setError('Con este mapeo no se detectó ningún movimiento con fecha y monto válidos.');
      return;
    }
    setStep('importing');
    setError(null);
    try {
      const res = await importarMovimientos(cliente.cuit, fuente, filas);
      setResumen(res);
      await cargarMovimientos();
      setStep('done');
      setShowSuccess(true);
      setTimeout(() => setOpen(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar el extracto.');
      setStep('mapping');
    }
  };

  const onClasificar = async (mov: MovimientoBancario, marca: 'ingreso-actividad' | 'no-es-venta') => {
    setClasificandoId(mov.id);
    try {
      const actualizado = await clasificarMovimiento(cliente.cuit, mov.id, { marcadoComo: marca });
      setMovimientos(prev => prev.map(m => (m.id === actualizado.id ? actualizado : m)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la clasificación.');
    } finally {
      setClasificandoId(null);
    }
  };

  const requeridosOk = ['fecha', 'monto'].every(f => Object.values(mapping).includes(f as CampoDestino));

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-danger shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showSuccess && resumen && (
        <SuccessBannerReal resumen={resumen} onDismiss={() => setShowSuccess(false)} onAddMore={openDialog} />
      )}

      <ResultadosTable
        movimientos={movimientos}
        cargando={cargando}
        onOpenDialog={openDialog}
        onClasificar={onClasificar}
        clasificandoId={clasificandoId}
        onFacturar={habilitadoFacturar ? setFacturarMov : undefined}
      />

      {/* Emisión desde un movimiento sin respaldo: prefilleamos el importe. Al emitir, re-corremos el
          matcher para que el comprobante nuevo quede asociado al movimiento. */}
      {habilitadoFacturar && (
        <EmitirComprobanteDialog
          cliente={cliente}
          open={!!facturarMov}
          onOpenChange={o => { if (!o) setFacturarMov(null); }}
          prefill={{ importe: facturarMov?.monto }}
          onEmitido={async () => {
            try {
              await reconciliarPendientes(cliente.cuit);
            } catch {
              /* el comprobante igual quedó emitido; el match se puede re-correr luego */
            }
            await cargarMovimientos();
          }}
        />
      )}

      <Dialog open={open} onOpenChange={o => { if (!o && step !== 'importing') setOpen(false); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 grid w-[min(960px,calc(100vw-2rem))] max-h-[90vh] overflow-auto translate-x-[-50%] translate-y-[-50%] border border-border/60 bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
              <div>
                <DialogTitle className="text-base font-semibold">Cargar extracto bancario</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {step === 'idle' && 'Soltá el archivo y leemos sus columnas reales.'}
                  {step === 'mapping' && 'Confirmá a qué corresponde cada columna del archivo.'}
                  {step === 'importing' && 'Importando y cruzando con los comprobantes de ARCA...'}
                  {step === 'done' && 'Listo. Cerrando ventana...'}
                </DialogDescription>
              </div>
              {step !== 'importing' && (
                <DialogPrimitive.Close className="rounded-md opacity-70 hover:opacity-100 transition-opacity p-1.5">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              )}
            </div>

            <div className="p-6">
              {step === 'idle' && <DropZone onFiles={onFile} multiple={false} />}
              {step === 'mapping' && parseado && (
                <MappingReal
                  file={file}
                  parseado={parseado}
                  mapping={mapping}
                  onChangeMapping={setMapping}
                  fuente={fuente}
                  onChangeFuente={setFuente}
                />
              )}
              {(step === 'importing' || step === 'done') && <ImportingReal fuente={fuente} done={step === 'done'} />}
            </div>

            {step === 'mapping' && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-border/60 bg-muted/30">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={confirmar} disabled={!requeridosOk}>
                  Reconciliar contra comprobantes <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </div>
  );
}

function MappingReal({
  file,
  parseado,
  mapping,
  onChangeMapping,
  fuente,
  onChangeFuente,
}: {
  file: { name: string; size: number } | null;
  parseado: ExtractoParseado;
  mapping: Record<string, CampoDestino>;
  onChangeMapping: (m: Record<string, CampoDestino>) => void;
  fuente: FuenteMovimiento;
  onChangeFuente: (f: FuenteMovimiento) => void;
}) {
  const { columnas, filas } = parseado;
  const preview = filas.slice(0, 5);
  const requeridosOk = ['fecha', 'monto'].every(f => Object.values(mapping).includes(f as CampoDestino));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-xs uppercase tracking-wider text-primary font-semibold">
          Paso 1 de 2 · Mapeo de columnas reales
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Archivo
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
            <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium truncate max-w-[260px]">{file?.name}</span>
            <span className="text-xs text-muted-foreground">
              {file ? `${(file.size / 1024).toFixed(0)} KB` : ''} · {filas.length} filas
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Fuente
          </div>
          <Select value={fuente} onValueChange={v => onChangeFuente(v as FuenteMovimiento)}>
            <SelectTrigger className="h-9 w-56 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUENTES.map(f => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Vista previa del extracto
        </div>
        <div className="rounded-xl border border-border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columnas.map((col, idx) => (
                  <TableHead key={`${col}-${idx}`} className="bg-muted/40">
                    <div className="space-y-1.5 py-2">
                      <div className="font-semibold text-foreground/80 normal-case tracking-normal text-xs truncate max-w-[180px]">
                        {col}
                      </div>
                      <Select
                        value={mapping[col] || 'ignorar'}
                        onValueChange={v => onChangeMapping({ ...mapping, [col]: v as CampoDestino })}
                      >
                        <SelectTrigger className="h-8 text-xs bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELDS.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row, i) => (
                <TableRow key={i}>
                  {columnas.map((col, j) => (
                    <TableCell
                      key={j}
                      className={cn(
                        'text-sm whitespace-nowrap',
                        mapping[col] === 'ignorar' && 'text-muted-foreground/50 line-through',
                      )}
                    >
                      {row[j]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Mostrando {preview.length} de {filas.length} filas. Sólo se importan las acreditaciones
          (montos positivos); los débitos se descartan.
        </div>
      </div>

      {!requeridosOk && (
        <div className="rounded-lg bg-warning/15 border border-warning/30 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-warning-foreground" />
          <span>
            Faltan asignar campos obligatorios: <strong>Fecha</strong> y <strong>Monto</strong>. El{' '}
            <strong>CUIT</strong> es opcional pero mejora el match.
          </span>
        </div>
      )}
    </div>
  );
}

function ImportingReal({ fuente, done }: { fuente: FuenteMovimiento; done: boolean }) {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-8">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary mb-4">
        {done ? <CheckCircle2 className="h-6 w-6 text-success" /> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
      <div className="text-base font-semibold tracking-tight">
        {done ? 'Conciliación completada' : 'Cruzando con los comprobantes de ARCA'}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        {done
          ? 'Guardamos los movimientos y su cruce.'
          : `Importando las acreditaciones del extracto de ${fuente === 'mercadopago' ? 'MercadoPago' : fuente} y matcheándolas por CUIT y monto.`}
      </p>
    </div>
  );
}

function SuccessBannerReal({
  resumen,
  onDismiss,
  onAddMore,
}: {
  resumen: ImportarResumen;
  onDismiss: () => void;
  onAddMore: () => void;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-success/15 via-success/8 to-card border border-success/30 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/20 text-success shrink-0">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Conciliación completada</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Importamos <span className="font-medium text-foreground">{resumen.importados} acreditaciones</span>,
            matcheamos <span className="font-medium text-success">{resumen.matcheadosAuto} automáticamente</span> y
            quedan <span className="font-medium text-warning-foreground">{resumen.pendientes} esperando tu revisión</span>.
            {resumen.duplicadosOmitidos > 0 && (
              <> Se omitieron <span className="font-medium">{resumen.duplicadosOmitidos} ya cargadas</span>.</>
            )}
            {resumen.debitosOmitidos > 0 && (
              <> Se descartaron <span className="font-medium">{resumen.debitosOmitidos} débitos</span>.</>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onAddMore}>
            <Plus className="h-3.5 w-3.5" /> Cargar más
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PIEZAS COMPARTIDAS (real + mock)
   ═══════════════════════════════════════════════════════════════════════════ */

interface ResultadosTableProps {
  movimientos: MovimientoBancario[];
  cargando?: boolean;
  onOpenDialog: () => void;
  onClasificar?: (mov: MovimientoBancario, marca: 'ingreso-actividad' | 'no-es-venta') => void;
  clasificandoId?: string | null;
  onFacturar?: (mov: MovimientoBancario) => void;
}

function ResultadosTable({
  movimientos,
  cargando,
  onOpenDialog,
  onClasificar,
  clasificandoId,
  onFacturar,
}: ResultadosTableProps) {
  const [filtro, setFiltro] = useState<'todos' | 'no-matcheados'>('todos');

  if (cargando) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
        <div className="text-sm text-muted-foreground mt-3">Cargando movimientos...</div>
      </Card>
    );
  }

  if (movimientos.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-primary/12 text-primary mb-4">
          <Link2 className="h-6 w-6" />
        </div>
        <div className="font-medium text-base">Todavía no cargaste extractos para este cliente</div>
        <div className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
          Subí un resumen bancario o de billetera virtual para empezar a cruzarlo con la facturación de ARCA.
        </div>
        <Button onClick={onOpenDialog} className="mt-5">
          <Upload className="h-4 w-4" /> Cargar primer extracto
        </Button>
      </Card>
    );
  }

  const visibles = movimientos.filter(m => (filtro === 'no-matcheados' ? !m.comprobanteMatcheadoId : true));
  const totalAcreditado = movimientos.reduce((s, m) => s + m.monto, 0);
  const matcheados = movimientos.filter(m => m.comprobanteMatcheadoId);
  const totalMatcheado = matcheados.reduce((s, m) => s + m.monto, 0);
  const cantPendiente = movimientos.filter(m => !m.comprobanteMatcheadoId && !m.marcadoComo).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60 bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">{movimientos.length} movimientos cargados</span>
        </div>
        <Button onClick={onOpenDialog} size="sm">
          <Upload className="h-3.5 w-3.5" /> Cargar extracto
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 border-b border-border/60 divide-y md:divide-y-0 md:divide-x divide-border/60">
        <Stat label="Total acreditado" value={formatCurrency(totalAcreditado)} subtitle="Movimientos cargados" />
        <Stat
          label="Match automático"
          value={formatCurrency(totalMatcheado)}
          subtitle={`${matcheados.length} mov.`}
          tone="success"
        />
        <Stat
          label="Sin matchear"
          value={formatCurrency(totalAcreditado - totalMatcheado)}
          subtitle={`${movimientos.length - matcheados.length} mov.`}
          tone={cantPendiente > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Pendiente revisión"
          value={String(cantPendiente)}
          subtitle="Esperan tu decisión"
          tone={cantPendiente > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="flex flex-col gap-3 p-4 border-b border-border/60 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground max-w-xl inline-flex items-center gap-1.5">
          Cada acreditación se cruzó con una factura emitida por importe y CUIT originante.
          <VerDetalle detalle={detalleConciliacion} />
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant={filtro === 'todos' ? 'default' : 'outline'} size="sm" onClick={() => setFiltro('todos')}>
            Todos
          </Button>
          <Button
            variant={filtro === 'no-matcheados' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFiltro('no-matcheados')}
          >
            Sólo no matcheados
          </Button>
        </div>
      </div>

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Fuente</TableHead>
              <TableHead>Originante</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Match automático</TableHead>
              <TableHead>Decisión del contador</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map(m => (
              <MovimientoRow
                key={m.id}
                mov={m}
                onClasificar={onClasificar}
                clasificando={clasificandoId === m.id}
                onFacturar={onFacturar}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 p-4 lg:hidden">
        {visibles.map(m => (
          <MovimientoCard
            key={m.id}
            mov={m}
            onClasificar={onClasificar}
            clasificando={clasificandoId === m.id}
            onFacturar={onFacturar}
          />
        ))}
      </div>
    </Card>
  );
}

/** Versión tarjeta de MovimientoRow para mobile: mismos datos y acciones, apilados. */
function MovimientoCard({
  mov,
  onClasificar,
  clasificando,
  onFacturar,
}: {
  mov: MovimientoBancario;
  onClasificar?: (mov: MovimientoBancario, marca: 'ingreso-actividad' | 'no-es-venta') => void;
  clasificando?: boolean;
  onFacturar?: (mov: MovimientoBancario) => void;
}) {
  const originante = mov.nombreOriginante || mov.descripcion || '—';
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{originante}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {mov.cuitOriginante ? formatCuit(mov.cuitOriginante) : ''}
          </div>
        </div>
        <div className="text-right tabular-nums font-medium whitespace-nowrap">
          {formatCurrency(mov.monto)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{formatDate(mov.fecha)}</span>
        <Badge variant="muted" className="capitalize">
          {mov.fuente === 'mercadopago' ? 'MercadoPago' : mov.fuente}
        </Badge>
        {mov.comprobanteMatcheadoId ? (
          <Badge variant={CONFIANZA_TONO[mov.matchConfianza ?? 'media'] ?? 'success'}>
            <Link2 className="h-3 w-3" /> Factura {mov.comprobanteMatcheadoId.slice(-4)}
          </Badge>
        ) : (
          <span>No matcheado</span>
        )}
        {mov.matchConfianza === 'sugerido' && (
          <span className="text-warning-foreground">a confirmar</span>
        )}
      </div>

      {!mov.comprobanteMatcheadoId &&
        (mov.marcadoComo === 'ingreso-actividad' ? (
          <span className="inline-flex items-center gap-2">
            <Badge variant="warning">Ingreso de actividad</Badge>
            {onFacturar && (
              <Button size="sm" variant="soft" onClick={() => onFacturar(mov)}>
                Facturar
              </Button>
            )}
          </span>
        ) : mov.marcadoComo === 'no-es-venta' ? (
          <Badge variant="muted">No es venta</Badge>
        ) : clasificando ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="soft"
              className="flex-1"
              onClick={() => onClasificar?.(mov, 'ingreso-actividad')}
              disabled={!onClasificar}
            >
              Es venta
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={() => onClasificar?.(mov, 'no-es-venta')}
              disabled={!onClasificar}
            >
              No es venta
            </Button>
          </div>
        ))}
    </Card>
  );
}

function MovimientoRow({
  mov,
  onClasificar,
  clasificando,
  onFacturar,
}: {
  mov: MovimientoBancario;
  onClasificar?: (mov: MovimientoBancario, marca: 'ingreso-actividad' | 'no-es-venta') => void;
  clasificando?: boolean;
  onFacturar?: (mov: MovimientoBancario) => void;
}) {
  const originante = mov.nombreOriginante || mov.descripcion || '—';
  return (
    <TableRow>
      <TableCell className="text-sm whitespace-nowrap">{formatDate(mov.fecha)}</TableCell>
      <TableCell>
        <Badge variant="muted" className="capitalize">
          {mov.fuente === 'mercadopago' ? 'MercadoPago' : mov.fuente}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="text-sm max-w-[280px] truncate">{originante}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {mov.cuitOriginante ? formatCuit(mov.cuitOriginante) : ''}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
        {formatCurrency(mov.monto)}
      </TableCell>
      <TableCell>
        {mov.comprobanteMatcheadoId ? (
          <div className="flex items-center gap-1.5">
            <Badge variant={CONFIANZA_TONO[mov.matchConfianza ?? 'media'] ?? 'success'}>
              <Link2 className="h-3 w-3" /> Factura {mov.comprobanteMatcheadoId.slice(-4)}
            </Badge>
            {mov.matchConfianza === 'sugerido' && (
              <span className="text-[11px] text-warning-foreground">a confirmar</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">No matcheado</span>
        )}
      </TableCell>
      <TableCell>
        {mov.comprobanteMatcheadoId ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : mov.marcadoComo === 'ingreso-actividad' ? (
          <span className="inline-flex items-center gap-2">
            <Badge variant="warning">Ingreso de actividad</Badge>
            {onFacturar && (
              <Button size="sm" variant="soft" onClick={() => onFacturar(mov)}>
                Facturar
              </Button>
            )}
          </span>
        ) : mov.marcadoComo === 'no-es-venta' ? (
          <Badge variant="muted">No es venta</Badge>
        ) : clasificando ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex gap-1.5">
            <Button size="sm" variant="soft" onClick={() => onClasificar?.(mov, 'ingreso-actividad')} disabled={!onClasificar}>
              Es venta
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onClasificar?.(mov, 'no-es-venta')} disabled={!onClasificar}>
              No es venta
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FLUJO MOCK (clientes demo): animación de demostración, sin backend
   ═══════════════════════════════════════════════════════════════════════════ */

type MockStep = 'idle' | 'mapping' | 'reconciling' | 'done';

const DETECTED_COLUMNS = ['Fecha', 'Descripción', 'CUIT / CBU', 'Importe', 'Saldo'];

const MOCK_TARGET_FIELDS = TARGET_FIELDS;

const DEFAULT_MAPPING: Record<string, string> = {
  Fecha: 'fecha',
  Descripción: 'descripcion',
  'CUIT / CBU': 'cuit',
  Importe: 'monto',
  Saldo: 'saldo',
};

const PREVIEW_ROWS: string[][] = [
  ['01/05/2026', 'TRANSFERENCIA RECIBIDA — JUAN PÉREZ', '20-11122233-4', '353.034,00', '1.245.892,30'],
  ['05/05/2026', 'PAGO RECIBIDO MERCADO PAGO', '30-22233344-5', '353.034,00', '1.598.926,30'],
  ['09/05/2026', 'COBRO COMERCIO SUR', '27-33344455-6', '353.034,00', '1.951.960,30'],
  ['12/05/2026', 'DEPÓSITO M. LÓPEZ', '23-44455566-7', '353.034,00', '2.304.994,30'],
  ['17/05/2026', 'MERCADO PAGO — VENTA', '24-55566677-8', '368.034,00', '2.673.028,30'],
];

const RECONCILE_PHASES = [
  { label: 'Leyendo extractos cargados', durationMs: 700 },
  { label: 'Identificando filas válidas', durationMs: 700 },
  { label: 'Cruzando con comprobantes emitidos en ARCA', durationMs: 900 },
  { label: 'Matcheando por CUIT y monto', durationMs: 700 },
  { label: 'Generando reporte', durationMs: 400 },
];

function ReconciliacionMock({ cliente }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<MockStep>('idle');
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING);
  const [showSuccess, setShowSuccess] = useState(false);
  const [reconciliadoMock, setReconciliadoMock] = useState(false);

  const openDialog = () => {
    setStep('idle');
    setFiles([]);
    setMapping(DEFAULT_MAPPING);
    setOpen(true);
  };

  const onAddFiles = useCallback((incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).map(f => ({ name: f.name, size: f.size }));
    if (arr.length === 0) return;
    setFiles(prev => [...prev, ...arr]);
    setStep('mapping');
  }, []);

  const startReconcile = () => setStep('reconciling');

  const finishReconcile = () => {
    setStep('done');
    setReconciliadoMock(true);
    setShowSuccess(true);
    setTimeout(() => setOpen(false), 1200);
  };

  const movimientosMock =
    cliente.movimientosBancarios.length > 0
      ? cliente.movimientosBancarios
      : reconciliadoMock
        ? mockReconciliados(cliente.id)
        : [];

  return (
    <div className="space-y-5">
      {showSuccess && (
        <SuccessBannerMock
          files={files}
          onDismiss={() => setShowSuccess(false)}
          onAddMore={() => { setShowSuccess(false); openDialog(); }}
        />
      )}

      <ResultadosTable movimientos={movimientosMock} onOpenDialog={openDialog} />

      <Dialog open={open} onOpenChange={o => { if (!o && step !== 'reconciling') setOpen(false); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 grid w-[min(960px,calc(100vw-2rem))] max-h-[90vh] overflow-auto translate-x-[-50%] translate-y-[-50%] border border-border/60 bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
              <div>
                <DialogTitle className="text-base font-semibold">Cargar extractos bancarios</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {step === 'idle' && 'Soltá uno o varios archivos y el sistema detecta las columnas.'}
                  {step === 'mapping' && 'Confirmá a qué corresponde cada columna del archivo.'}
                  {step === 'reconciling' && 'Procesando los movimientos cargados...'}
                  {step === 'done' && 'Listo. Cerrando ventana...'}
                </DialogDescription>
              </div>
              {step !== 'reconciling' && (
                <DialogPrimitive.Close className="rounded-md opacity-70 hover:opacity-100 transition-opacity p-1.5">
                  <X className="h-4 w-4" />
                </DialogPrimitive.Close>
              )}
            </div>

            <div className="p-6">
              {step === 'idle' && <DropZone onFiles={onAddFiles} />}
              {step === 'mapping' && (
                <MappingBodyMock
                  files={files}
                  mapping={mapping}
                  onChangeMapping={setMapping}
                  onAddMore={onAddFiles}
                  onRemoveFile={name =>
                    setFiles(prev => {
                      const next = prev.filter(f => f.name !== name);
                      if (next.length === 0) setStep('idle');
                      return next;
                    })
                  }
                />
              )}
              {(step === 'reconciling' || step === 'done') && (
                <ReconcilingBodyMock files={files} onDone={finishReconcile} freezeAtDone={step === 'done'} />
              )}
            </div>

            {step === 'mapping' && (
              <MappingFooterMock mapping={mapping} onCancel={() => setOpen(false)} onConfirm={startReconcile} />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </div>
  );
}

function MappingBodyMock({
  files,
  mapping,
  onChangeMapping,
  onAddMore,
  onRemoveFile,
}: {
  files: { name: string; size: number }[];
  mapping: Record<string, string>;
  onChangeMapping: (m: Record<string, string>) => void;
  onAddMore: (f: FileList | File[] | null) => void;
  onRemoveFile: (name: string) => void;
}) {
  const addMoreRef = useRef<HTMLInputElement>(null);
  const requiredFields = ['fecha', 'cuit', 'monto'];
  const allRequiredMapped = requiredFields.every(f => Object.values(mapping).includes(f));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-xs uppercase tracking-wider text-primary font-semibold">
          Paso 1 de 2 · Mapeo de columnas
        </span>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Archivos cargados
        </div>
        <div className="flex flex-wrap gap-2">
          {files.map(f => (
            <div key={f.name} className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium truncate max-w-[260px]">{f.name}</span>
              <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => onRemoveFile(f.name)} className="text-muted-foreground hover:text-foreground -mr-1">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => addMoreRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar otro archivo
          </button>
          <input
            ref={addMoreRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv,.txt,.pdf"
            className="hidden"
            onChange={e => onAddMore(e.target.files)}
          />
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Vista previa del extracto
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {DETECTED_COLUMNS.map(col => (
                  <TableHead key={col} className="bg-muted/40">
                    <div className="space-y-1.5 py-2">
                      <div className="font-semibold text-foreground/80 normal-case tracking-normal text-xs">{col}</div>
                      <Select value={mapping[col] || 'ignorar'} onValueChange={v => onChangeMapping({ ...mapping, [col]: v })}>
                        <SelectTrigger className="h-8 text-xs bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MOCK_TARGET_FIELDS.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PREVIEW_ROWS.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell
                      key={j}
                      className={cn(
                        'text-sm whitespace-nowrap',
                        mapping[DETECTED_COLUMNS[j]] === 'ignorar' && 'text-muted-foreground/50 line-through',
                      )}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Mostrando las primeras 5 filas de {files.length === 1 ? '1 archivo' : `${files.length} archivos`}.
        </div>
      </div>

      {!allRequiredMapped && (
        <div className="rounded-lg bg-warning/15 border border-warning/30 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-warning-foreground" />
          <span>
            Faltan asignar campos obligatorios: <strong>Fecha</strong>, <strong>CUIT</strong> y <strong>Monto</strong>.
          </span>
        </div>
      )}
    </div>
  );
}

function MappingFooterMock({
  mapping,
  onCancel,
  onConfirm,
}: {
  mapping: Record<string, string>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const requiredFields = ['fecha', 'cuit', 'monto'];
  const allRequiredMapped = requiredFields.every(f => Object.values(mapping).includes(f));
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border/60 bg-muted/30">
      <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      <Button onClick={onConfirm} disabled={!allRequiredMapped}>
        Reconciliar contra comprobantes <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ReconcilingBodyMock({
  files,
  onDone,
  freezeAtDone,
}: {
  files: { name: string; size: number }[];
  onDone: () => void;
  freezeAtDone: boolean;
}) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (freezeAtDone) {
      setProgress(100);
      setPhaseIdx(RECONCILE_PHASES.length);
      return;
    }
    let cancelled = false;
    let elapsed = 0;
    const totalMs = RECONCILE_PHASES.reduce((s, p) => s + p.durationMs, 0);

    const advance = (i: number) => {
      if (cancelled) return;
      setPhaseIdx(i);
      if (i >= RECONCILE_PHASES.length) {
        setProgress(100);
        setTimeout(() => !cancelled && onDone(), 250);
        return;
      }
      const phase = RECONCILE_PHASES[i];
      const start = Date.now();
      const baseProgress = (elapsed / totalMs) * 100;
      const phaseShare = (phase.durationMs / totalMs) * 100;
      const tick = () => {
        if (cancelled) return;
        const t = Math.min(1, (Date.now() - start) / phase.durationMs);
        setProgress(baseProgress + phaseShare * t);
        if (t < 1) requestAnimationFrame(tick);
        else {
          elapsed += phase.durationMs;
          advance(i + 1);
        }
      };
      requestAnimationFrame(tick);
    };

    advance(0);
    return () => { cancelled = true; };
  }, [onDone, freezeAtDone]);

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-6">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary mb-4">
        {freezeAtDone ? <CheckCircle2 className="h-6 w-6 text-success" /> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
      <div className="text-base font-semibold tracking-tight">
        {freezeAtDone ? 'Reconciliación completada' : 'Reconciliando movimientos'}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        {files.length === 1 ? 'Procesando 1 archivo cargado.' : `Procesando los ${files.length} archivos cargados.`}
      </p>

      <div className="w-full mt-5">
        <Progress value={progress} className="h-1.5" />
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">{Math.round(progress)}%</div>
      </div>

      <ul className="mt-5 w-full space-y-1.5">
        {RECONCILE_PHASES.map((p, i) => (
          <li
            key={p.label}
            className={cn(
              'flex items-center gap-2.5 text-sm transition-all',
              i < phaseIdx && 'text-success',
              i === phaseIdx && 'text-foreground font-medium',
              i > phaseIdx && 'text-muted-foreground/50',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {i < phaseIdx ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : i === phaseIdx ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuccessBannerMock({
  files,
  onDismiss,
  onAddMore,
}: {
  files: { name: string; size: number }[];
  onDismiss: () => void;
  onAddMore: () => void;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-success/15 via-success/8 to-card border border-success/30 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/20 text-success shrink-0">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-semibold">Reconciliación completada</div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Se procesaron{' '}
            <span className="font-medium text-foreground">
              {files.length === 1 ? '1 archivo' : `${files.length} archivos`}
            </span>
            . Importamos <span className="font-medium text-foreground">18 acreditaciones</span>, matcheamos{' '}
            <span className="font-medium text-success">14 automáticamente</span> y quedan{' '}
            <span className="font-medium text-warning-foreground">4 esperando tu revisión</span>.
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onAddMore}>
            <Plus className="h-3.5 w-3.5" /> Cargar más
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function mockReconciliados(clienteId: string): MovimientoBancario[] {
  const meses = ['2026-03', '2026-04', '2026-05'];
  const out: MovimientoBancario[] = [];
  meses.forEach((mes, mIdx) => {
    for (let i = 0; i < 6; i++) {
      const matched = i < 4;
      out.push({
        id: `${clienteId}-mock-${mes}-${i}`,
        fecha: `${mes}-${String(2 + i * 4).padStart(2, '0')}`,
        monto: 350_000 + (i % 3) * 18_000 + mIdx * 8_500,
        fuente: i % 2 === 0 ? 'mercadopago' : 'banco',
        cuitOriginante: ['20111222334', '30222333445', '27333444556', '23444555667', '24555666778'][i % 5],
        nombreOriginante: ['Juan Pérez', 'Empresa SRL', 'Comercio Sur', 'María López', 'Cliente Casual'][i % 5],
        comprobanteMatcheadoId: matched ? `${mes}-e-${i}` : undefined,
        marcadoComo: !matched && i === 4 ? 'ingreso-actividad' : !matched && i === 5 ? 'no-es-venta' : undefined,
        marcadoPorContador: !matched && i >= 4 ? 'Felipe Durso' : undefined,
        marcadoEn: !matched && i >= 4 ? `${mes}-${String(15 + i).padStart(2, '0')}` : undefined,
      });
    }
  });
  return out;
}
