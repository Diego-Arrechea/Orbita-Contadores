import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Loader2, FileText, Info, Scale, Download, Check, AlertTriangle, Upload } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useClientesReales } from '@/lib/queries';
import {
  getPeriodosIva,
  getLibroIva,
  getPosicionIva,
  guardarAjustesIva,
  getInconsistenciasIva,
  importarBorradorIva,
  descargarLibroIvaDigital,
  type DireccionIva,
  type IvaLibro,
  type IvaSubtotales,
  type IvaPosicion,
  type IvaLado,
  type IvaInconsistencia,
} from '@/services/ivaService';
import { mensajeDeError } from '@/services/authService';
import { formatCurrency, formatCuit, cn } from '@/lib/utils';

type VistaIva = 'libro' | 'posicion';

/**
 * Apartado de IVA (piloto). Muestra el Libro IVA de Ventas/Compras de un cliente por período, armado
 * con los comprobantes que la app ya tiene. El desglose de IVA discriminado (neto/IVA de un
 * Responsable Inscripto) se irá completando; en Monotributo no hay IVA discriminado (neto = total).
 *
 * Rollout gateado: sólo llegan acá las cuentas habilitadas (RequireIVA); el backend valida el mismo
 * gate en cada endpoint.
 */
export function IVA() {
  const { data: cartera = [], isLoading: cargandoCartera } = useClientesReales();
  const [cuit, setCuit] = useState<string>('');
  const [vista, setVista] = useState<VistaIva>('libro');
  const [direccion, setDireccion] = useState<DireccionIva>('ventas');
  const [periodo, setPeriodo] = useState<string>('');
  const [descargando, setDescargando] = useState<DireccionIva | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [avisoImport, setAvisoImport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // El Libro IVA es para Responsables Inscriptos: los monotributistas no tienen IVA, así que no
  // aparecen en el selector. Se excluyen sólo los CONFIRMADOS monotributo (se dejan RI, no
  // monotributistas y los que todavía están en proceso, para no ocultar un RI sin régimen resuelto).
  const carteraIva = useMemo(() => cartera.filter(c => c.regimen !== 'monotributo'), [cartera]);

  // Cliente elegido (default: el primero de la cartera en cuanto carga).
  const cuitActivo = cuit || carteraIva[0]?.cuit || '';
  const clienteActivo = carteraIva.find(c => c.cuit === cuitActivo);

  const { data: periodos = [], isLoading: cargandoPeriodos } = useQuery({
    queryKey: ['iva', 'periodos', cuitActivo],
    queryFn: () => getPeriodosIva(cuitActivo),
    enabled: !!cuitActivo,
  });

  // Período elegido (default: el más reciente disponible).
  const periodoActivo = periodo || periodos[0]?.periodo || '';

  const { data: libro, isLoading: cargandoLibro } = useQuery({
    queryKey: ['iva', 'libro', cuitActivo, periodoActivo, direccion],
    queryFn: () => getLibroIva(cuitActivo, periodoActivo, direccion),
    enabled: !!cuitActivo && !!periodoActivo && vista === 'libro',
  });

  const { data: posicion, isLoading: cargandoPosicion } = useQuery({
    queryKey: ['iva', 'posicion', cuitActivo, periodoActivo],
    queryFn: () => getPosicionIva(cuitActivo, periodoActivo),
    enabled: !!cuitActivo && !!periodoActivo && vista === 'posicion',
  });

  const { data: inconsistencias = [] } = useQuery({
    queryKey: ['iva', 'inconsistencias', cuitActivo, periodoActivo],
    queryFn: () => getInconsistenciasIva(cuitActivo, periodoActivo),
    enabled: !!cuitActivo && !!periodoActivo,
  });

  const sub = libro?.subtotales;
  // ¿La columna IVA aporta algo en este libro? (en Monotributo es siempre 0). Si no, se atenúa.
  const hayIva = useMemo(
    () => (libro?.lineas ?? []).some(l => l.iva !== 0),
    [libro]
  );

  async function importarBorrador(file: File) {
    if (!cuitActivo) return;
    setImportando(true);
    setAvisoImport(null);
    try {
      const r = await importarBorradorIva(cuitActivo, file);
      setAvisoImport(
        `Importado: ${r.actualizados} comprobante${r.actualizados === 1 ? '' : 's'} actualizado${r.actualizados === 1 ? '' : 's'}` +
          (r.sin_match ? ` · ${r.sin_match} sin coincidencia` : '')
      );
      // Refrescar posición, libro e inconsistencias del cliente (ahora con la percepción IVA real).
      qc.invalidateQueries({ queryKey: ['iva', 'posicion', cuitActivo] });
      qc.invalidateQueries({ queryKey: ['iva', 'libro', cuitActivo] });
      qc.invalidateQueries({ queryKey: ['iva', 'inconsistencias', cuitActivo] });
    } catch (e) {
      setAvisoImport(mensajeDeError(e));
    } finally {
      setImportando(false);
    }
  }

  async function descargarLid(dir: DireccionIva) {
    if (!cuitActivo || !periodoActivo) return;
    setDescargando(dir);
    setErrorDescarga(null);
    try {
      await descargarLibroIvaDigital(cuitActivo, periodoActivo, dir);
    } catch (e) {
      setErrorDescarga(mensajeDeError(e));
    } finally {
      setDescargando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">IVA</h1>
          <Badge variant="outline" className="text-warning-foreground border-warning/50 bg-warning/10">
            Piloto
          </Badge>
        </div>
        <p className="text-base text-muted-foreground mt-2">
          Libro IVA de Ventas y Compras de tus clientes, armado con sus comprobantes.
        </p>
      </div>

      {/* Selectores: cliente + período */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cliente</label>
            <Select
              value={cuitActivo}
              onValueChange={v => {
                setCuit(v);
                setPeriodo(''); // el nuevo cliente tiene otros períodos: volvé al más reciente
              }}
              disabled={cargandoCartera || carteraIva.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue placeholder={cargandoCartera ? 'Cargando…' : 'Elegí un cliente'} />
              </SelectTrigger>
              <SelectContent>
                {carteraIva.map(c => (
                  <SelectItem key={c.cuit} value={c.cuit}>
                    {c.nombre} · {formatCuit(c.cuit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Período</label>
            <Select
              value={periodoActivo}
              onValueChange={setPeriodo}
              disabled={cargandoPeriodos || periodos.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue
                  placeholder={
                    cargandoPeriodos ? 'Cargando…' : periodos.length ? 'Elegí un período' : 'Sin períodos'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {periodos.map(p => (
                  <SelectItem key={p.periodo} value={p.periodo}>
                    {p.label}
                    <span className="text-muted-foreground">
                      {'  ·  '}
                      {direccion === 'ventas' ? `${p.ventas} vta.` : `${p.compras} cpr.`}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Tabs value={vista} onValueChange={v => setVista(v as VistaIva)}>
            <TabsList>
              <TabsTrigger value="libro">Libro IVA</TabsTrigger>
              <TabsTrigger value="posicion">Posición</TabsTrigger>
            </TabsList>
          </Tabs>
          {vista === 'libro' && (
            <Tabs value={direccion} onValueChange={v => setDireccion(v as DireccionIva)}>
              <TabsList>
                <TabsTrigger value="ventas">Ventas</TabsTrigger>
                <TabsTrigger value="compras">Compras</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {periodoActivo && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <span className="hidden text-xs text-muted-foreground sm:inline">Libro IVA Digital:</span>
              {(['ventas', 'compras'] as const).map(dir => (
                <Button
                  key={dir}
                  variant="outline"
                  size="sm"
                  onClick={() => descargarLid(dir)}
                  disabled={descargando !== null}
                  title={`Descarga el Libro IVA Digital de ${dir} (formato AFIP)`}
                >
                  {descargando === dir ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {dir === 'ventas' ? 'Ventas' : 'Compras'}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={importando}
                title="Importá el borrador que bajás del Portal IVA de AFIP (ZIP o CSV) para traer las percepciones reales"
              >
                {importando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Importar de AFIP
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,.csv,text/csv,application/zip"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) importarBorrador(f);
                  e.target.value = ''; // permite re-subir el mismo archivo
                }}
              />
            </div>
          )}
        </div>
        {errorDescarga && <p className="mt-2 text-sm text-danger">{errorDescarga}</p>}
        {avisoImport && <p className="mt-2 text-sm text-muted-foreground">{avisoImport}</p>}
      </Card>

      {/* Revisiones sugeridas (inconsistencias) — visible en ambas vistas */}
      {inconsistencias.length > 0 && <InconsistenciasCard items={inconsistencias} />}

      {/* Contenido */}
      {!cargandoCartera && carteraIva.length === 0 ? (
        <EstadoVacio
          titulo="No tenés clientes con IVA"
          detalle="El Libro IVA es para Responsables Inscriptos. Los monotributistas no aparecen acá porque no liquidan IVA."
        />
      ) : (cargandoLibro || cargandoPosicion || cargandoPeriodos) && periodoActivo ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !periodoActivo ? (
        <EstadoVacio
          titulo="Sin comprobantes en este período"
          detalle={
            clienteActivo
              ? `${clienteActivo.nombre} no tiene comprobantes registrados en el período elegido.`
              : 'Elegí un cliente y un período para ver su IVA.'
          }
        />
      ) : vista === 'posicion' ? (
        posicion ? (
          <PosicionView posicion={posicion} cuit={cuitActivo} periodo={periodoActivo} />
        ) : null
      ) : !libro || libro.lineas.length === 0 ? (
        <EstadoVacio
          titulo="Sin comprobantes en este período"
          detalle={
            clienteActivo
              ? `${clienteActivo.nombre} no tiene ${direccion === 'ventas' ? 'ventas' : 'compras'} registradas en el período elegido.`
              : 'Elegí un cliente y un período para ver su Libro IVA.'
          }
        />
      ) : (
        <LibroTabla libro={libro} sub={sub!} hayIva={hayIva} direccion={direccion} />
      )}
    </div>
  );
}

/** Posición de IVA del período (estilo F2002): débito vs crédito → saldo del impuesto, con el
 *  desglose por alícuota de ventas y compras + los ajustes manuales del contador. */
function PosicionView({
  posicion: p,
  cuit,
  periodo,
}: {
  posicion: IvaPosicion;
  cuit: string;
  periodo: string;
}) {
  const qc = useQueryClient();
  const saldo = p.saldoImpuesto;
  return (
    <div className="space-y-4">
      {/* Resultado principal */}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <ResultadoCelda label="Débito fiscal" detalle="IVA de ventas" valor={p.debitoFiscal} />
          <ResultadoCelda label="Crédito fiscal" detalle="IVA de compras" valor={p.creditoFiscal} />
          <ResultadoCelda
            label="Saldo técnico"
            detalle="Débito − crédito"
            valor={p.saldoTecnico}
            fuerte
          />
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4" />
              <span>
                Saldo técnico {formatCurrency(p.saldoTecnico)} − pagos a cuenta{' '}
                {formatCurrency(p.retenciones + p.otrosPagos)} − saldo a favor anterior{' '}
                {formatCurrency(p.saldoFavorAnterior)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {p.aFavor ? 'Saldo a favor' : 'Saldo a pagar'}
            </div>
            <div
              className={cn(
                'text-3xl font-semibold tabular-nums',
                p.aFavor ? 'text-success' : 'text-foreground'
              )}
            >
              {formatCurrency(saldo)}
            </div>
          </div>
        </div>
      </Card>

      <AjustesPosicion
        posicion={p}
        onGuardado={() => qc.invalidateQueries({ queryKey: ['iva', 'posicion', cuit, periodo] })}
        cuit={cuit}
        periodo={periodo}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <LadoCard titulo="Débito fiscal — Ventas" lado={p.ventas} montoLabel="Débito" />
        <LadoCard titulo="Crédito fiscal — Compras" lado={p.compras} montoLabel="Crédito" />
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          El saldo a favor anterior y las retenciones los cargás abajo. La percepción IVA sale del
          borrador de AFIP que importes (botón “Importar de AFIP”); si no lo importaste, queda en 0.
          La alícuota se estima por comprobante; los que combinan varias alícuotas aparecen en “Otras”.
        </span>
      </div>
    </div>
  );
}

/** Editor de los ajustes que el contador completa (Órbita no los deriva de los comprobantes):
 *  saldo a favor de períodos anteriores, retenciones de IVA sufridas y otros pagos a cuenta. */
function AjustesPosicion({
  posicion: p,
  cuit,
  periodo,
  onGuardado,
}: {
  posicion: IvaPosicion;
  cuit: string;
  periodo: string;
  onGuardado: () => void;
}) {
  const num = (v: number) => (v ? String(v) : '');
  const [saldoAnt, setSaldoAnt] = useState(num(p.saldoFavorAnterior));
  const [reten, setReten] = useState(num(p.retenciones));
  const [otros, setOtros] = useState(num(p.otrosPagos));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Re-sincroniza los inputs cuando cambia el cliente/período o llega la posición fresca.
  useEffect(() => {
    setSaldoAnt(num(p.saldoFavorAnterior));
    setReten(num(p.retenciones));
    setOtros(num(p.otrosPagos));
    setOk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuit, periodo, p.saldoFavorAnterior, p.retenciones, p.otrosPagos]);

  const parse = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0;

  async function guardar() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      await guardarAjustesIva(cuit, periodo, {
        saldoFavorAnterior: parse(saldoAnt),
        retenciones: parse(reten),
        otrosPagos: parse(otros),
      });
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  const campo = (label: string, val: string, set: (v: string) => void, hint: string) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={val}
        onChange={e => {
          set(e.target.value);
          setOk(false);
        }}
        inputMode="decimal"
        placeholder="0,00"
        className="mt-1 h-9 text-right tabular-nums"
      />
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">Ajustes del período</div>
      <div className="grid gap-3 sm:grid-cols-3">
        {campo('Saldo a favor período anterior', saldoAnt, setSaldoAnt, 'Libre disponibilidad que traés')}
        {campo('Retenciones de IVA', reten, setReten, 'Retenciones sufridas en el período')}
        {campo('Otros pagos a cuenta', otros, setOtros, 'Otros conceptos a favor')}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Guardar ajustes
        </Button>
        {ok && <span className="text-sm text-success">Guardado ✓</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </Card>
  );
}

function ResultadoCelda({
  label,
  detalle,
  valor,
  fuerte,
}: {
  label: string;
  detalle: string;
  valor: number;
  fuerte?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('tabular-nums', fuerte ? 'text-2xl font-semibold' : 'text-xl font-medium')}>
        {formatCurrency(valor)}
      </div>
      <div className="text-xs text-muted-foreground">{detalle}</div>
    </div>
  );
}

function LadoCard({ titulo, lado, montoLabel }: { titulo: string; lado: IvaLado; montoLabel: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3 font-medium">{titulo}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alícuota</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">{montoLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lado.porAlicuota.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  Sin operaciones gravadas
                </TableCell>
              </TableRow>
            ) : (
              lado.porAlicuota.map(a => (
                <TableRow key={a.alicuota}>
                  <TableCell>{a.alicuota}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(a.neto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(a.iva)}</TableCell>
                </TableRow>
              ))
            )}
            {lado.exento !== 0 && (
              <TableRow className="text-muted-foreground">
                <TableCell>Exento</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(lado.exento)}</TableCell>
                <TableCell className="text-right tabular-nums">—</TableCell>
              </TableRow>
            )}
            {lado.noGravado !== 0 && (
              <TableRow className="text-muted-foreground">
                <TableCell>No gravado</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(lado.noGravado)}</TableCell>
                <TableCell className="text-right tabular-nums">—</TableCell>
              </TableRow>
            )}
            {lado.tributos !== 0 && (
              <TableRow className="text-muted-foreground">
                <TableCell>Percepciones / otros tributos</TableCell>
                <TableCell className="text-right tabular-nums">—</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(lado.tributos)}</TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">
                {lado.cantidad} comprobante{lado.cantidad === 1 ? '' : 's'}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(lado.neto)}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(lado.iva)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </Card>
  );
}

/** Revisiones sugeridas del período: posibles errores en los comprobantes a chequear antes de
 *  declarar (IVA en cero, alícuota atípica, compra sin CUIT). No corrige nada, sólo marca. */
function InconsistenciasCard({ items }: { items: IvaInconsistencia[] }) {
  return (
    <Card className="overflow-hidden border-warning/40">
      <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-warning-foreground" />
        <span className="text-sm font-medium">
          {items.length} revisión{items.length === 1 ? '' : 'es'} sugerida{items.length === 1 ? '' : 's'} en este período
        </span>
      </div>
      <ul className="divide-y">
        {items.map((it, i) => (
          <li key={`${it.comprobanteId}-${it.tipo}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
            <Badge variant="outline" className="shrink-0 text-xs">
              {it.lado === 'ventas' ? 'Venta' : 'Compra'}
            </Badge>
            <span className="font-medium tabular-nums">{it.comprobante}</span>
            <span className="text-muted-foreground">· {it.contraparte}</span>
            <span className="w-full text-muted-foreground sm:w-auto sm:flex-1">{it.detalle}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EstadoVacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Percent className="h-6 w-6" />
      </div>
      <div className="font-medium">{titulo}</div>
      <div className="max-w-md text-sm text-muted-foreground">{detalle}</div>
    </Card>
  );
}

function LibroTabla({
  libro,
  sub,
  hayIva,
  direccion,
}: {
  libro: IvaLibro;
  sub: IvaSubtotales;
  hayIva: boolean;
  direccion: DireccionIva;
}) {
  const contraparte = direccion === 'ventas' ? 'Cliente' : 'Proveedor';
  return (
    <Card className="overflow-hidden">
      {/* Escritorio: tabla */}
      <div className="hidden lg:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Comprobante</TableHead>
              <TableHead>{contraparte}</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className={cn('text-right', !hayIva && 'text-muted-foreground/60')}>IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {libro.lineas.map(l => (
              <TableRow key={l.id} className={cn(l.esNotaCredito && 'text-danger')}>
                <TableCell className="whitespace-nowrap tabular-nums">{fechaCorta(l.fecha)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{l.tipo}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {String(l.puntoVenta).padStart(5, '0')}-{l.numero}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[22rem] truncate">{l.contraparteNombre}</div>
                  {l.contraparteCuit && (
                    <div className="text-xs text-muted-foreground tabular-nums">{l.contraparteCuit}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{signo(l.esNotaCredito, l.neto)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', !hayIva && 'text-muted-foreground/60')}>
                  {signo(l.esNotaCredito, l.iva)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {signo(l.esNotaCredito, l.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                {sub.cantidad} comprobante{sub.cantidad === 1 ? '' : 's'}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.neto)}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.iva)}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(sub.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Mobile: tarjetas (convención del proyecto tabla→tarjetas) */}
      <div className="lg:hidden divide-y">
        {libro.lineas.map(l => (
          <div key={l.id} className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={cn(l.esNotaCredito && 'text-danger')}>{l.tipo}</span>
                <span className="tabular-nums text-muted-foreground">
                  {String(l.puntoVenta).padStart(5, '0')}-{l.numero}
                </span>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{fechaCorta(l.fecha)}</span>
            </div>
            <div className="truncate text-sm text-muted-foreground">{l.contraparteNombre}</div>
            <div className="flex justify-between text-sm tabular-nums">
              <span className="text-muted-foreground">Neto {signo(l.esNotaCredito, l.neto)}</span>
              <span className="text-muted-foreground">IVA {signo(l.esNotaCredito, l.iva)}</span>
              <span className={cn('font-medium', l.esNotaCredito && 'text-danger')}>
                {signo(l.esNotaCredito, l.total)}
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between p-4 font-semibold">
          <span>Total ({sub.cantidad})</span>
          <span className="tabular-nums">{formatCurrency(sub.total)}</span>
        </div>
      </div>

      {!hayIva && direccion === 'ventas' && (
        <div className="flex items-start gap-2 border-t bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este cliente no discrimina IVA en sus comprobantes (régimen de Monotributo): el neto
            coincide con el total.
          </span>
        </div>
      )}
    </Card>
  );
}

function signo(esNc: boolean, valor: number): string {
  const v = esNc ? -Math.abs(valor) : valor;
  return formatCurrency(v);
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}
