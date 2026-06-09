import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  Check,
  Plus,
  Users,
  FileSpreadsheet,
  Sparkles,
  ArrowRight,
  ChevronRight,
  HelpCircle,
  FileText,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DropZone, Stat } from '@/components/cliente/conciliacionShared';
import {
  parsearArchivo,
  autoMapear,
  normalizarFilas,
  inferirFuente,
  type ExtractoParseado,
  type FuenteMovimiento,
  type MovimientoNormalizado,
} from '@/lib/parsearExtracto';
import { identificarTitular, type TitularIdentificado } from '@/lib/identificarTitular';
import {
  parsearPdf,
  desglosarPorCategoria,
  CATEGORIA_LABEL,
  type MovimientoPdf,
  type DesgloseCategoria,
  type CategoriaPdf,
} from '@/lib/parsearPdf';
import { getClientesReales } from '@/services/clientesService';
import {
  procesarExtractos,
  type AsignacionExtracto,
  type ResultadoExtracto,
} from '@/services/conciliacionService';
import { formatCurrency, formatCuit, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

const FUENTE_LABEL: Record<FuenteMovimiento, string> = {
  banco: 'Banco',
  mercadopago: 'MercadoPago',
  otro: 'Otra cuenta',
};

/** Estado de un extracto cargado mientras se parsea y se asigna a su cliente, antes de procesarlo. */
interface ExtractoCargado {
  id: string;
  nombre: string;
  size: number;
  fuente: FuenteMovimiento;
  parseado: ExtractoParseado | null;
  filas: MovimientoNormalizado[];
  clienteCuit: string | null;
  identificacion: TitularIdentificado | null;
  estado: 'leyendo' | 'listo' | 'sin-cliente' | 'sin-datos' | 'error';
  error?: string;
  // Sólo para PDFs de MercadoPago: el detalle clasificado y el desglose del filtrado automático.
  esPdf?: boolean;
  movimientosMP?: MovimientoPdf[];
  desglose?: DesgloseCategoria[];
  /** Categorías de "ruido" que el contador decidió incluir igual además de los cobros. */
  categoriasExtra?: CategoriaPdf[];
}

/** Filas a conciliar de un PDF: siempre los cobros, más las categorías que el contador incluyó. */
function filasDePdf(movs: MovimientoPdf[], extra: CategoriaPdf[]): MovimientoNormalizado[] {
  return movs
    .filter(m => m.monto > 0 && (m.categoria === 'cobro' || extra.includes(m.categoria)))
    .map(m => ({ fecha: m.fecha, monto: m.monto, descripcion: m.descripcion }));
}

/**
 * Conciliación CENTRAL: pantalla de CARGA MASIVA. El contador suelta muchos extractos de una; cada
 * archivo se asigna SOLO a su cliente (identificarTitular) y se cruza contra las facturas de ARCA
 * reutilizando el endpoint por-cliente. Tras procesar muestra un resumen corto con link a cada ficha:
 * la revisión y clasificación transacción-por-transacción se hace allá, NO acá.
 */
export function Conciliacion() {
  const [cartera, setCartera] = useState<Cliente[]>([]);
  const [cargandoCartera, setCargandoCartera] = useState(true);
  const [extractos, setExtractos] = useState<ExtractoCargado[]>([]);
  const [procesando, setProcesando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoExtracto[] | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    getClientesReales()
      .then(setCartera)
      .catch(() => {}) // sin backend: la página queda lista pero sin cartera
      .finally(() => setCargandoCartera(false));
  }, []);

  // Parsea cada archivo soltado, lo normaliza e intenta identificar a su cliente automáticamente.
  const onFiles = useCallback(
    async (incoming: FileList | File[] | null) => {
      if (!incoming) return;
      setErrorGeneral(null);
      for (const file of Array.from(incoming)) {
        const id = `ext-${(nextId.current += 1)}`;
        setExtractos(prev => [
          ...prev,
          {
            id,
            nombre: file.name,
            size: file.size,
            fuente: inferirFuente(file.name),
            parseado: null,
            filas: [],
            clienteCuit: null,
            identificacion: null,
            estado: 'leyendo',
          },
        ]);
        try {
          if (/\.pdf$/i.test(file.name)) {
            // PDF de banco/billetera: el dispatcher detecta el formato (MercadoPago, Banco Provincia…),
            // parsea y filtra automáticamente el ruido (deja sólo los cobros conciliables).
            const ext = await parsearPdf(file);
            const filas = filasDePdf(ext.movimientos, []);
            // Reusamos identificarTitular armando una "cabecera" con el titular y CUIT del PDF.
            const pseudo: ExtractoParseado = {
              columnas: [],
              filas: [],
              metadatos: [[ext.titular.nombre ?? ''], [ext.titular.cuit ?? '']],
            };
            const ident = identificarTitular(pseudo, file.name, cartera);
            setExtractos(prev =>
              prev.map(e =>
                e.id === id
                  ? {
                      ...e,
                      esPdf: true,
                      fuente: ext.banco === 'mercadopago' ? 'mercadopago' : 'banco',
                      parseado: pseudo,
                      movimientosMP: ext.movimientos,
                      desglose: desglosarPorCategoria(ext.movimientos),
                      categoriasExtra: [],
                      filas,
                      clienteCuit: ident?.clienteCuit ?? null,
                      identificacion: ident,
                      estado: filas.length === 0 ? 'sin-datos' : ident ? 'listo' : 'sin-cliente',
                    }
                  : e,
              ),
            );
          } else {
            const parseado = await parsearArchivo(file);
            const filas = normalizarFilas(parseado.filas, parseado.columnas, autoMapear(parseado.columnas));
            const ident = identificarTitular(parseado, file.name, cartera);
            setExtractos(prev =>
              prev.map(e =>
                e.id === id
                  ? {
                      ...e,
                      parseado,
                      filas,
                      clienteCuit: ident?.clienteCuit ?? null,
                      identificacion: ident,
                      estado: filas.length === 0 ? 'sin-datos' : ident ? 'listo' : 'sin-cliente',
                    }
                  : e,
              ),
            );
          }
        } catch (err) {
          setExtractos(prev =>
            prev.map(e =>
              e.id === id
                ? {
                    ...e,
                    estado: 'error',
                    error: err instanceof Error ? err.message : 'No se pudo leer el archivo.',
                  }
                : e,
            ),
          );
        }
      }
    },
    [cartera],
  );

  const asignarCliente = (extractoId: string, cuit: string) =>
    setExtractos(prev =>
      prev.map(e =>
        e.id === extractoId
          ? { ...e, clienteCuit: cuit, estado: e.filas.length === 0 ? 'sin-datos' : 'listo' }
          : e,
      ),
    );

  const cambiarFuente = (extractoId: string, fuente: FuenteMovimiento) =>
    setExtractos(prev => prev.map(e => (e.id === extractoId ? { ...e, fuente } : e)));

  // Incluir/excluir una categoría de ruido (PDF): recalcula las filas a conciliar de ese extracto.
  const toggleCategoria = (extractoId: string, cat: CategoriaPdf) =>
    setExtractos(prev =>
      prev.map(e => {
        if (e.id !== extractoId || !e.movimientosMP) return e;
        const extra = e.categoriasExtra ?? [];
        const next = extra.includes(cat) ? extra.filter(c => c !== cat) : [...extra, cat];
        const filas = filasDePdf(e.movimientosMP, next);
        return {
          ...e,
          categoriasExtra: next,
          filas,
          estado: filas.length === 0 ? 'sin-datos' : e.clienteCuit ? 'listo' : 'sin-cliente',
        };
      }),
    );

  const quitar = (extractoId: string) =>
    setExtractos(prev => prev.filter(e => e.id !== extractoId));

  const listos = extractos.filter(e => e.clienteCuit && e.filas.length > 0);

  const procesar = async () => {
    if (listos.length === 0) return;
    setProcesando(true);
    setErrorGeneral(null);
    try {
      const asignaciones: AsignacionExtracto[] = listos.map(e => ({
        extractoId: e.id,
        clienteCuit: e.clienteCuit as string,
        fuente: e.fuente,
        filas: e.filas,
      }));
      const res = await procesarExtractos(asignaciones);
      const okIds = new Set(res.filter(r => r.ok).map(r => r.extractoId));
      const fallados = res.filter(r => !r.ok);
      // Los procesados con éxito salen de la bandeja; los que fallaron quedan con su error.
      setExtractos(prev =>
        prev
          .filter(e => !okIds.has(e.id))
          .map(e => {
            const fallo = fallados.find(r => r.extractoId === e.id);
            return fallo ? { ...e, estado: 'error' as const, error: fallo.error } : e;
          }),
      );
      setResultados(res);
      if (fallados.length > 0) {
        setErrorGeneral(`No se pudieron procesar ${fallados.length} extracto(s). Revisá el detalle en la lista.`);
      }
    } catch (e) {
      setErrorGeneral(e instanceof Error ? e.message : 'No se pudo procesar la carga.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Conciliación bancaria</h1>
          <AyudaConciliacion />
        </div>
        <p className="text-base text-muted-foreground mt-2 max-w-3xl">
          Cargá los extractos de tus clientes: los asignamos solos a cada uno y cruzamos cada movimiento
          con lo facturado en ARCA. Después revisás el detalle en la ficha de cada cliente.
        </p>
      </div>

      {errorGeneral && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-2.5 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-danger shrink-0" />
          <span className="flex-1">{errorGeneral}</span>
          <button onClick={() => setErrorGeneral(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {cargandoCartera ? (
        <Card className="p-12 text-center border-dashed">
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
          <div className="text-sm text-muted-foreground mt-3">Cargando tu cartera…</div>
        </Card>
      ) : cartera.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-primary/12 text-primary mb-4">
            <Users className="h-6 w-6" />
          </div>
          <div className="font-medium text-base">Todavía no tenés clientes conectados a ARCA</div>
          <div className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Para conciliar extractos necesitás al menos un cliente con sus comprobantes de ARCA.
          </div>
          <Button asChild className="mt-5">
            <Link to="/clientes/nuevo">Agregar un cliente</Link>
          </Button>
        </Card>
      ) : (
        <>
          <Card className="p-6">
            <DropZone
              onFiles={onFiles}
              multiple
              accept=".xlsx,.xls,.csv,.txt,.pdf"
              formatos="XLSX, CSV o PDF"
            />
          </Card>

          {extractos.length > 0 && (
            <BandejaAsignacion
              extractos={extractos}
              cartera={cartera}
              procesando={procesando}
              listosCount={listos.length}
              onAsignar={asignarCliente}
              onCambiarFuente={cambiarFuente}
              onToggleCategoria={toggleCategoria}
              onQuitar={quitar}
              onProcesar={procesar}
            />
          )}

          {resultados && (
            <ResumenProcesamiento
              resultados={resultados}
              cartera={cartera}
              onCerrar={() => setResultados(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AYUDA: cómo usar la página + formatos/bancos soportados (popover del "?")
   ═══════════════════════════════════════════════════════════════════════════ */

const PASOS = [
  'Arrastrá o seleccioná los extractos de tus clientes. Podés cargar varios juntos.',
  'Asignamos cada archivo a su cliente automáticamente; si no lo reconocemos, lo elegís a mano.',
  'Tocá “Conciliar” y cruzamos cada movimiento con lo facturado en ARCA.',
  'Revisás y clasificás el detalle de cada movimiento en la ficha del cliente.',
];

/** Bancos/billeteras con parser de PDF dedicado. Las planillas (XLSX/CSV) usan un parser genérico
 * que detecta fecha/importe por los encabezados: cubre la mayoría de los exports, no es por-banco. */
const BANCOS_PDF = ['MercadoPago', 'Banco Provincia', 'Brubank'];

function AyudaConciliacion() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Cómo usar esta página"
          aria-label="Cómo usar esta página"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-96 p-0">
        <div className="px-4 py-3 border-b border-border/60">
          <div className="text-sm font-semibold">Cómo conciliar extractos</div>
        </div>
        <ol className="p-4 space-y-2.5">
          {PASOS.map((paso, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary text-[11px] font-semibold tabular-nums">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-snug">{paso}</span>
            </li>
          ))}
        </ol>
        <div className="px-4 py-3 border-t border-border/60 bg-muted/30">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Formatos soportados
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Planilla <span className="font-medium">XLSX, XLS o CSV</span> — la mayoría de los bancos</span>
            </li>
            <li className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">PDF</span> — {BANCOS_PDF.join(', ')}
              </span>
            </li>
          </ul>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BANDEJA DE ASIGNACIÓN: un renglón por extracto cargado, con su cliente detectado
   ═══════════════════════════════════════════════════════════════════════════ */

function BandejaAsignacion({
  extractos,
  cartera,
  procesando,
  listosCount,
  onAsignar,
  onCambiarFuente,
  onToggleCategoria,
  onQuitar,
  onProcesar,
}: {
  extractos: ExtractoCargado[];
  cartera: Cliente[];
  procesando: boolean;
  listosCount: number;
  onAsignar: (id: string, cuit: string) => void;
  onCambiarFuente: (id: string, fuente: FuenteMovimiento) => void;
  onToggleCategoria: (id: string, cat: CategoriaPdf) => void;
  onQuitar: (id: string) => void;
  onProcesar: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60 bg-muted/30">
        <div className="text-sm font-medium">
          {extractos.length} extracto{extractos.length !== 1 ? 's' : ''} en cola
        </div>
        <Button onClick={onProcesar} disabled={listosCount === 0 || procesando} size="sm">
          {procesando ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cruzando con ARCA…
            </>
          ) : (
            <>
              Conciliar {listosCount} extracto{listosCount !== 1 ? 's' : ''} <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
      <div className="divide-y divide-border/60">
        {extractos.map(e => (
          <FilaExtracto
            key={e.id}
            extracto={e}
            cartera={cartera}
            disabled={procesando}
            onAsignar={onAsignar}
            onCambiarFuente={onCambiarFuente}
            onToggleCategoria={onToggleCategoria}
            onQuitar={onQuitar}
          />
        ))}
      </div>
    </Card>
  );
}

function FilaExtracto({
  extracto,
  cartera,
  disabled,
  onAsignar,
  onCambiarFuente,
  onToggleCategoria,
  onQuitar,
}: {
  extracto: ExtractoCargado;
  cartera: Cliente[];
  disabled: boolean;
  onAsignar: (id: string, cuit: string) => void;
  onCambiarFuente: (id: string, fuente: FuenteMovimiento) => void;
  onToggleCategoria: (id: string, cat: CategoriaPdf) => void;
  onQuitar: (id: string) => void;
}) {
  const e = extracto;
  const cliente = e.clienteCuit ? cartera.find(c => c.cuit === e.clienteCuit) : undefined;
  const autoIdentificado = !!e.identificacion && e.clienteCuit === e.identificacion.clienteCuit;

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate max-w-[260px]">{e.nombre}</div>
          <div className="text-xs text-muted-foreground">
            {(e.size / 1024).toFixed(0)} KB
            {e.estado === 'leyendo' && ' · leyendo…'}
            {e.estado !== 'leyendo' && e.parseado && ` · ${e.filas.length} movimientos`}
          </div>
        </div>
      </div>

      {/* Fuente del extracto (afecta la tolerancia del cruce; MercadoPago descuenta comisión). */}
      {e.parseado && e.estado !== 'error' && (
        <Select value={e.fuente} onValueChange={v => onCambiarFuente(e.id, v as FuenteMovimiento)} disabled={disabled}>
          <SelectTrigger className="h-9 w-full sm:w-40 bg-card shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FUENTE_LABEL) as FuenteMovimiento[]).map(f => (
              <SelectItem key={f} value={f}>{FUENTE_LABEL[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Cliente asignado: si lo identificamos solos lo mostramos; si no, selector manual. */}
      <div className="flex items-center gap-2 sm:w-[300px] shrink-0">
        {e.estado === 'leyendo' ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando…
          </span>
        ) : e.estado === 'error' ? (
          <span className="text-xs text-danger inline-flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" /> {e.error}
          </span>
        ) : (
          <div className="flex-1 min-w-0">
            <Select
              value={e.clienteCuit ?? ''}
              onValueChange={v => onAsignar(e.id, v)}
              disabled={disabled}
            >
              <SelectTrigger className={cn('h-9 bg-card', !e.clienteCuit && 'border-warning/60')}>
                <SelectValue placeholder="Asigná un cliente…" />
              </SelectTrigger>
              <SelectContent>
                {cartera.map(c => (
                  <SelectItem key={c.cuit} value={c.cuit}>
                    {c.nombre} · {formatCuit(c.cuit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cliente && autoIdentificado && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-success">
                <Sparkles className="h-3 w-3" /> {e.identificacion?.motivo}
              </div>
            )}
            {!e.clienteCuit && e.estado === 'sin-cliente' && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-warning-foreground">
                <AlertTriangle className="h-3 w-3" /> No pudimos identificar al titular: elegilo a mano.
              </div>
            )}
            {e.estado === 'sin-datos' && (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> No se detectaron movimientos en este archivo.
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={() => onQuitar(e.id)}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground transition-colors p-1.5 self-start sm:self-center disabled:opacity-40"
        title="Quitar"
      >
        <X className="h-4 w-4" />
      </button>
      </div>
      {e.esPdf && e.desglose && e.estado !== 'error' && e.estado !== 'leyendo' && (
        <DesgloseFiltrado extracto={e} disabled={disabled} onToggleCategoria={onToggleCategoria} />
      )}
    </div>
  );
}

/** Desglose del filtrado automático de un PDF de MercadoPago: cuántos cobros se concilian y qué se
 * descartó por categoría, con opción de incluir una categoría igual. */
function DesgloseFiltrado({
  extracto,
  disabled,
  onToggleCategoria,
}: {
  extracto: ExtractoCargado;
  disabled: boolean;
  onToggleCategoria: (id: string, cat: CategoriaPdf) => void;
}) {
  const e = extracto;
  const desglose = e.desglose ?? [];
  const incluidas = e.categoriasExtra ?? [];
  const cobros = desglose.find(d => d.categoria === 'cobro');
  // El ruido = todo lo que no es cobro ni egreso (los egresos/salidas no se concilian nunca).
  const ruido = desglose.filter(d => d.categoria !== 'cobro' && d.categoria !== 'egreso');

  return (
    <div className="mt-3 ml-12 rounded-lg bg-muted/40 border border-border/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 text-success font-medium">
        <Sparkles className="h-3.5 w-3.5" />
        {cobros ? `${cobros.cantidad} cobros de terceros para conciliar` : 'No detectamos cobros de terceros'}
        {cobros ? ` · ${formatCurrency(cobros.monto)}` : ''}
      </div>
      {ruido.length > 0 && (
        <>
          <div className="mt-2 text-muted-foreground">
            Descartamos automáticamente (no son ventas). Tocá para incluir una igual:
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ruido.map(d => {
              const activa = incluidas.includes(d.categoria);
              return (
                <button
                  key={d.categoria}
                  onClick={() => onToggleCategoria(e.id, d.categoria)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40',
                    activa
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/50',
                  )}
                  title={activa ? 'Incluida en la conciliación' : 'Excluida (clic para incluir)'}
                >
                  {activa ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  {CATEGORIA_LABEL[d.categoria]} ({d.cantidad}) · {formatCurrency(d.monto)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESUMEN DE PROCESAMIENTO: feedback corto tras conciliar, con link a cada ficha
   ═══════════════════════════════════════════════════════════════════════════ */

function ResumenProcesamiento({
  resultados,
  cartera,
  onCerrar,
}: {
  resultados: ResultadoExtracto[];
  cartera: Cliente[];
  onCerrar: () => void;
}) {
  const ok = resultados.filter(r => r.ok && r.resumen);
  // Acumulamos por cliente (puede haber varios extractos del mismo).
  const porCliente = new Map<string, { importados: number; matcheados: number; pendientes: number }>();
  for (const r of ok) {
    const acc = porCliente.get(r.clienteCuit) ?? { importados: 0, matcheados: 0, pendientes: 0 };
    acc.importados += r.resumen!.importados;
    acc.matcheados += r.resumen!.matcheadosAuto;
    acc.pendientes += r.resumen!.pendientes;
    porCliente.set(r.clienteCuit, acc);
  }
  const totalImportados = [...porCliente.values()].reduce((s, c) => s + c.importados, 0);
  const totalMatch = [...porCliente.values()].reduce((s, c) => s + c.matcheados, 0);
  const totalPend = [...porCliente.values()].reduce((s, c) => s + c.pendientes, 0);
  const nombreDe = (cuit: string) => cartera.find(c => c.cuit === cuit)?.nombre ?? formatCuit(cuit);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60 bg-success/10">
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4" />
          Conciliación completada · {ok.length} extracto{ok.length !== 1 ? 's' : ''}
        </div>
        <button onClick={onCerrar} className="text-muted-foreground hover:text-foreground" title="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 border-b border-border/60 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
        <Stat label="Movimientos importados" value={String(totalImportados)} subtitle="Ingresos cargados" />
        <Stat label="Conciliados con ARCA" value={String(totalMatch)} subtitle="Cruzados con una factura" tone="success" />
        <Stat
          label="Sin respaldo en ARCA"
          value={String(totalPend)}
          subtitle="Para revisar en la ficha"
          tone={totalPend > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="p-4">
        <div className="text-xs text-muted-foreground mb-3">
          La revisión y clasificación de cada movimiento se hace en la ficha del cliente.
        </div>
        <div className="space-y-1.5">
          {[...porCliente.entries()].map(([cuit, c]) => (
            <Link
              key={cuit}
              to={`/clientes/${cuit}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-2.5 hover:border-primary/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                  {nombreDe(cuit)}
                </div>
                <div className="text-xs text-muted-foreground">{formatCuit(cuit)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="muted">{c.importados} mov.</Badge>
                <Badge variant="success">{c.matcheados} conciliados</Badge>
                {c.pendientes > 0 && <Badge variant="warning">{c.pendientes} sin respaldo</Badge>}
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}
