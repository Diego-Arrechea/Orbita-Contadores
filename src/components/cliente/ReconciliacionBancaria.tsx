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

type Step = 'idle' | 'mapping' | 'reconciling' | 'done';

const DETECTED_COLUMNS = ['Fecha', 'Descripción', 'CUIT / CBU', 'Importe', 'Saldo'];

const TARGET_FIELDS = [
  { value: 'fecha', label: 'Fecha del movimiento' },
  { value: 'descripcion', label: 'Descripción / Detalle' },
  { value: 'cuit', label: 'CUIT contraparte' },
  { value: 'monto', label: 'Monto (ARS)' },
  { value: 'saldo', label: 'Saldo posterior' },
  { value: 'ignorar', label: '— Ignorar columna —' },
];

const DEFAULT_MAPPING: Record<string, string> = {
  Fecha: 'fecha',
  Descripción: 'descripcion',
  'CUIT / CBU': 'cuit',
  Importe: 'monto',
  Saldo: 'saldo',
};

const PREVIEW_ROWS: string[][] = [
  ['01/05/2026', 'TRANSFERENCIA RECIBIDA — JUAN PÉREZ',  '20-11122233-4', '353.034,00', '1.245.892,30'],
  ['05/05/2026', 'PAGO RECIBIDO MERCADO PAGO',            '30-22233344-5', '353.034,00', '1.598.926,30'],
  ['09/05/2026', 'COBRO COMERCIO SUR',                    '27-33344455-6', '353.034,00', '1.951.960,30'],
  ['12/05/2026', 'DEPÓSITO M. LÓPEZ',                     '23-44455566-7', '353.034,00', '2.304.994,30'],
  ['17/05/2026', 'MERCADO PAGO — VENTA',                  '24-55566677-8', '368.034,00', '2.673.028,30'],
];

const RECONCILE_PHASES = [
  { label: 'Leyendo extractos cargados',                    durationMs: 700 },
  { label: 'Identificando filas válidas',                   durationMs: 700 },
  { label: 'Cruzando con comprobantes emitidos en ARCA',    durationMs: 900 },
  { label: 'Matcheando por CUIT y monto',                   durationMs: 700 },
  { label: 'Generando reporte',                             durationMs: 400 },
];

interface Props {
  cliente: Cliente;
}

export function ReconciliacionBancaria({ cliente }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('idle');
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

  const onAddFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming) return;
      const arr = Array.from(incoming).map(f => ({ name: f.name, size: f.size }));
      if (arr.length === 0) return;
      setFiles(prev => [...prev, ...arr]);
      setStep('mapping');
    },
    [],
  );

  const startReconcile = () => setStep('reconciling');

  const finishReconcile = () => {
    setStep('done');
    setReconciliadoMock(true);
    setShowSuccess(true);
    setTimeout(() => setOpen(false), 1200);
  };

  return (
    <div className="space-y-5">
      {showSuccess && (
        <SuccessBanner
          files={files}
          onDismiss={() => setShowSuccess(false)}
          onAddMore={() => {
            setShowSuccess(false);
            openDialog();
          }}
        />
      )}

      <ResultadosCard
        cliente={cliente}
        freshlyLoaded={reconciliadoMock}
        onOpenDialog={openDialog}
      />

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && step !== 'reconciling') setOpen(false);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-50 grid w-[min(960px,calc(100vw-2rem))] max-h-[90vh] overflow-auto translate-x-[-50%] translate-y-[-50%] border border-border/60 bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
              <div>
                <DialogTitle className="text-base font-semibold">
                  Cargar extractos bancarios
                </DialogTitle>
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

            {/* Body */}
            <div className="p-6">
              {step === 'idle' && <DropZone onFiles={onAddFiles} />}
              {step === 'mapping' && (
                <MappingBody
                  files={files}
                  mapping={mapping}
                  onChangeMapping={setMapping}
                  onAddMore={onAddFiles}
                  onRemoveFile={(name) =>
                    setFiles(prev => {
                      const next = prev.filter(f => f.name !== name);
                      if (next.length === 0) setStep('idle');
                      return next;
                    })
                  }
                />
              )}
              {(step === 'reconciling' || step === 'done') && (
                <ReconcilingBody
                  files={files}
                  onDone={finishReconcile}
                  freezeAtDone={step === 'done'}
                />
              )}
            </div>

            {/* Footer */}
            {step === 'mapping' && (
              <MappingFooter
                mapping={mapping}
                onCancel={() => setOpen(false)}
                onConfirm={startReconcile}
              />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    </div>
  );
}

/* ─────────────── Drop zone ─────────────── */

function DropZone({ onFiles }: { onFiles: (files: FileList | File[] | null) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        onFiles(e.dataTransfer.files);
      }}
      className={cn(
        'block rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-all',
        isDragging
          ? 'border-primary bg-primary/8 scale-[1.01]'
          : 'border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10',
      )}
    >
      <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-primary/15 text-primary mb-3 transition-transform">
        <Upload className="h-5 w-5" />
      </div>
      <div className="font-semibold">
        {isDragging ? 'Soltá los archivos acá' : 'Arrastrá los extractos bancarios'}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        o hacé clic para seleccionar. XLSX, CSV, TXT o PDF tabular. Podés cargar varios a la vez.
      </div>
      <Button variant="outline" className="mt-4" type="button" onClick={(e) => {
        e.preventDefault();
        inputRef.current?.click();
      }}>
        <FileSpreadsheet className="h-4 w-4" /> Seleccionar archivos
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.txt,.pdf"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </label>
  );
}

/* ─────────────── Mapping body ─────────────── */

interface MappingBodyProps {
  files: { name: string; size: number }[];
  mapping: Record<string, string>;
  onChangeMapping: (m: Record<string, string>) => void;
  onAddMore: (f: FileList | File[] | null) => void;
  onRemoveFile: (name: string) => void;
}

function MappingBody({
  files,
  mapping,
  onChangeMapping,
  onAddMore,
  onRemoveFile,
}: MappingBodyProps) {
  const addMoreRef = useRef<HTMLInputElement>(null);
  const requiredFields = ['fecha', 'cuit', 'monto'];
  const mappedFields = Object.values(mapping);
  const allRequiredMapped = requiredFields.every(f => mappedFields.includes(f));

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
            <div
              key={f.name}
              className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium truncate max-w-[260px]">{f.name}</span>
              <span className="text-xs text-muted-foreground">
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button
                onClick={() => onRemoveFile(f.name)}
                className="text-muted-foreground hover:text-foreground -mr-1"
              >
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
            onChange={(e) => onAddMore(e.target.files)}
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
                      <div className="font-semibold text-foreground/80 normal-case tracking-normal text-xs">
                        {col}
                      </div>
                      <Select
                        value={mapping[col] || 'ignorar'}
                        onValueChange={(v) => onChangeMapping({ ...mapping, [col]: v })}
                      >
                        <SelectTrigger className="h-8 text-xs bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELDS.map(t => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
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
                        mapping[DETECTED_COLUMNS[j]] === 'ignorar' &&
                          'text-muted-foreground/50 line-through',
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
            Faltan asignar campos obligatorios: <strong>Fecha</strong>, <strong>CUIT</strong> y{' '}
            <strong>Monto</strong>.
          </span>
        </div>
      )}
    </div>
  );
}

function MappingFooter({
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
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
      <Button onClick={onConfirm} disabled={!allRequiredMapped}>
        Reconciliar contra comprobantes <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ─────────────── Reconciling body (animation) ─────────────── */

function ReconcilingBody({
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
    return () => {
      cancelled = true;
    };
  }, [onDone, freezeAtDone]);

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-6">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary mb-4">
        {freezeAtDone ? (
          <CheckCircle2 className="h-6 w-6 text-success" />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin" />
        )}
      </div>
      <div className="text-base font-semibold tracking-tight">
        {freezeAtDone ? 'Reconciliación completada' : 'Reconciliando movimientos'}
      </div>
      <p className="text-sm text-muted-foreground mt-1">
        {files.length === 1 ? 'Procesando 1 archivo cargado.' : `Procesando los ${files.length} archivos cargados.`}
      </p>

      <div className="w-full mt-5">
        <Progress value={progress} className="h-1.5" />
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">
          {Math.round(progress)}%
        </div>
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

/* ─────────────── Success banner ─────────────── */

function SuccessBanner({
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
            . Importamos <span className="font-medium text-foreground">18 acreditaciones</span>,
            matcheamos <span className="font-medium text-success">14 automáticamente</span> y
            quedan <span className="font-medium text-warning-foreground">4 esperando tu revisión</span>.
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

/* ─────────────── Resultados table ─────────────── */

function ResultadosCard({
  cliente,
  freshlyLoaded,
  onOpenDialog,
}: {
  cliente: Cliente;
  freshlyLoaded: boolean;
  onOpenDialog: () => void;
}) {
  const [filtro, setFiltro] = useState<'todos' | 'no-matcheados'>('todos');

  const movimientosFuente =
    cliente.movimientosBancarios.length > 0
      ? cliente.movimientosBancarios
      : freshlyLoaded
        ? mockReconciliados(cliente.id)
        : [];

  if (movimientosFuente.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-primary/12 text-primary mb-4">
          <Link2 className="h-6 w-6" />
        </div>
        <div className="font-medium text-base">
          Todavía no cargaste extractos para este cliente
        </div>
        <div className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
          Subí uno o más resúmenes bancarios o de billeteras virtuales para empezar a cruzarlos con
          la facturación de ARCA.
        </div>
        <Button onClick={onOpenDialog} className="mt-5">
          <Upload className="h-4 w-4" /> Cargar primer extracto
        </Button>
      </Card>
    );
  }

  const movimientos = movimientosFuente.filter(m =>
    filtro === 'no-matcheados' ? !m.comprobanteMatcheadoId : true,
  );

  const totalAcreditado = movimientosFuente.reduce((s, m) => s + m.monto, 0);
  const totalMatcheado = movimientosFuente
    .filter(m => m.comprobanteMatcheadoId)
    .reduce((s, m) => s + m.monto, 0);
  const totalNoMatcheado = totalAcreditado - totalMatcheado;
  const cantPendiente = movimientosFuente.filter(
    m => !m.comprobanteMatcheadoId && !m.marcadoComo,
  ).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60 bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">{movimientosFuente.length} movimientos cargados</span>
          <span className="text-muted-foreground ml-2">· últimos 3 meses</span>
        </div>
        <Button onClick={onOpenDialog} size="sm">
          <Upload className="h-3.5 w-3.5" /> Cargar extractos
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 border-b border-border/60 divide-y md:divide-y-0 md:divide-x divide-border/60">
        <Stat
          label="Total acreditado"
          value={formatCurrency(totalAcreditado)}
          subtitle="Últimos 3 meses"
        />
        <Stat
          label="Match automático"
          value={formatCurrency(totalMatcheado)}
          subtitle={`${movimientosFuente.filter(m => m.comprobanteMatcheadoId).length} mov.`}
          tone="success"
        />
        <Stat
          label="Sin matchear"
          value={formatCurrency(totalNoMatcheado)}
          subtitle={`${movimientosFuente.filter(m => !m.comprobanteMatcheadoId).length} mov.`}
          tone={cantPendiente > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Pendiente revisión"
          value={String(cantPendiente)}
          subtitle="Esperan tu decisión"
          tone={cantPendiente > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="flex items-center justify-between p-4 border-b border-border/60">
        <div className="text-sm text-muted-foreground max-w-xl">
          Cada acreditación se cruzó con una factura emitida por importe y CUIT originante.
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant={filtro === 'todos' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFiltro('todos')}
          >
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
          {movimientos.map(m => (
            <MovimientoRow key={m.id} mov={m} />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function MovimientoRow({ mov }: { mov: MovimientoBancario }) {
  return (
    <TableRow>
      <TableCell className="text-sm whitespace-nowrap">{formatDate(mov.fecha)}</TableCell>
      <TableCell>
        <Badge variant="muted" className="capitalize">
          {mov.fuente === 'mercadopago' ? 'MercadoPago' : mov.fuente}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="text-sm">{mov.nombreOriginante || '—'}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {mov.cuitOriginante ? formatCuit(mov.cuitOriginante) : ''}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
        {formatCurrency(mov.monto)}
      </TableCell>
      <TableCell>
        {mov.comprobanteMatcheadoId ? (
          <Badge variant="success">
            <Link2 className="h-3 w-3" /> Factura {mov.comprobanteMatcheadoId.slice(-4)}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">No matcheado</span>
        )}
      </TableCell>
      <TableCell>
        {mov.comprobanteMatcheadoId ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : mov.marcadoComo === 'ingreso-actividad' ? (
          <Badge variant="warning">Ingreso de actividad</Badge>
        ) : mov.marcadoComo === 'no-es-venta' ? (
          <Badge variant="muted">No es venta</Badge>
        ) : (
          <div className="flex gap-1.5">
            <Button size="sm" variant="soft">
              Es venta
            </Button>
            <Button size="sm" variant="ghost">
              No es venta
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function Stat({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
        {label}
      </div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning-foreground',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
          {tone === 'warning' && <AlertCircle className="h-3 w-3" />}
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Mock data fallback ─────────────── */

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
