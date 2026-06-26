import { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Search,
  Package,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
} from 'lucide-react';
import { descargarComprobantePdf, mensajeErrorFacturacion } from '@/services/facturacionService';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
import { formatCurrency, formatDate, formatCuit, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

const POR_PAGINA = 20;

// Clasifica un comprobante por su tipo (string) para el filtro. Por exclusión: lo que no es
// nota de crédito/débito ni recibo es factura (cubre Factura A/B/C/E/M, FCE y tiques).
type TipoFiltro = 'todos' | 'facturas' | 'nc' | 'nd' | 'recibos';
function coincideTipo(tipoComprobante: string, filtro: TipoFiltro): boolean {
  const esNC = tipoComprobante.includes('Nota Crédito');
  const esND = tipoComprobante.includes('Nota Débito');
  const esRecibo = tipoComprobante.includes('Recibo');
  switch (filtro) {
    case 'todos':
      return true;
    case 'nc':
      return esNC;
    case 'nd':
      return esND;
    case 'recibos':
      return esRecibo;
    case 'facturas':
      return !esNC && !esND && !esRecibo;
  }
}

/** Icono cuadrado del comprobante (emitido = primario, recibido = neutro). */
function IconoComprobante({ direccion }: { direccion: 'emitido' | 'recibido' }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        direccion === 'emitido' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      <FileText className="h-4 w-4" />
    </div>
  );
}

/** Monto del comprobante. En moneda extranjera (p.ej. Factura E de exportación) muestra el original
 *  + la cotización del día; el tope se consolida en pesos. Las notas de crédito van con signo menos. */
function MontoComprobante({ c }: { c: Cliente['comprobantes'][number] }) {
  const esNC = c.tipo.includes('Nota Crédito');
  if (c.moneda && c.moneda !== 'ARS') {
    return (
      <>
        <div>
          {esNC ? '-' : ''}
          {formatCurrency(c.montoOrigen ?? c.monto, { moneda: c.moneda })}
        </div>
        {!!c.cotizacion && c.cotizacion !== 1 && (
          <div className="text-[11px] font-normal text-muted-foreground">
            TC ${c.cotizacion.toLocaleString('es-AR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {esNC ? '-' : ''}
      {formatCurrency(c.monto)}
    </>
  );
}

/**
 * Botón de PDF del comprobante.
 *  • Emitido desde la app (`c.tienePdf`): descarga la representación impresa (PDF con CAE + QR).
 *  • Resto (traído de Mis Comprobantes): su PDF oficial vive en ARCA, no lo reconstruimos → deshabilitado.
 * El <span> recibe el hover cuando el Button está disabled (pointer-events-none se lo comería).
 */
function BotonPdf({ c, cuit }: { c: Cliente['comprobantes'][number]; cuit: string }) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState('');

  if (!c.tienePdf || !c.cbteTipo) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button size="icon" variant="ghost" disabled aria-label="Comprobante sin PDF en la app">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>El PDF de este comprobante no está disponible acá</TooltipContent>
      </Tooltip>
    );
  }

  const descargar = async () => {
    setError('');
    setDescargando(true);
    try {
      await descargarComprobantePdf(cuit, {
        cbte_tipo: c.cbteTipo!,
        punto_venta: c.puntoVenta,
        numero: Number(c.numero),
      });
    } catch (e) {
      setError(mensajeErrorFacturacion(e));
    } finally {
      setDescargando(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          disabled={descargando}
          onClick={descargar}
          aria-label="Descargar comprobante (PDF)"
          className={error ? 'text-danger' : undefined}
        >
          {descargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{error || 'Descargar comprobante (PDF)'}</TooltipContent>
    </Tooltip>
  );
}

export function ListaComprobantes({ cliente }: Props) {
  const [direccion, setDireccion] = useState<'todos' | 'emitido' | 'recibido'>('todos');
  const [tipo, setTipo] = useState<TipoFiltro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [pagina, setPagina] = useState(1);

  const comprobantes = useMemo(
    () =>
      cliente.comprobantes
        .filter(c => (direccion === 'todos' ? true : c.direccion === direccion))
        .filter(c => coincideTipo(c.tipo, tipo))
        // Rango de fechas de emisión (inclusive). fechaEmision es 'YYYY-MM-DD', comparable lexicográficamente.
        .filter(c => (!fechaDesde || c.fechaEmision >= fechaDesde) && (!fechaHasta || c.fechaEmision <= fechaHasta))
        .filter(c => {
          if (!busqueda) return true;
          const q = busqueda.toLowerCase();
          return (
            c.contraparteNombre.toLowerCase().includes(q) ||
            c.numero.includes(busqueda) ||
            c.contraparteCuit.includes(busqueda.replace(/\D/g, ''))
          );
        })
        // Más nuevas primero; dentro del mismo día desempata por punto de venta y número
        // (si no, las del mismo día quedaban en orden arbitrario y no coincidía con Mis Comprobantes).
        .sort(
          (a, b) =>
            b.fechaEmision.localeCompare(a.fechaEmision) ||
            b.puntoVenta - a.puntoVenta ||
            b.numero.localeCompare(a.numero),
        ),
    [cliente.comprobantes, direccion, tipo, busqueda, fechaDesde, fechaHasta],
  );

  // Al cambiar los filtros, volver a la primera página.
  useEffect(() => setPagina(1), [direccion, tipo, busqueda, fechaDesde, fechaHasta]);

  const totalPaginas = Math.max(1, Math.ceil(comprobantes.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * POR_PAGINA;
  const visibles = comprobantes.slice(desde, desde + POR_PAGINA);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col md:flex-row gap-3 p-4 border-b border-border/60 bg-muted/20">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por número, contraparte o CUIT"
            className="pl-9 bg-card"
          />
        </div>
        <Select value={direccion} onValueChange={(v) => setDireccion(v as typeof direccion)}>
          <SelectTrigger className="w-full md:w-[160px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="emitido">Emitidos</SelectItem>
            <SelectItem value="recibido">Recibidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-full md:w-[180px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            <SelectItem value="facturas">Facturas</SelectItem>
            <SelectItem value="nc">Notas de crédito</SelectItem>
            <SelectItem value="nd">Notas de débito</SelectItem>
            <SelectItem value="recibos">Recibos</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={fechaDesde}
            max={fechaHasta || undefined}
            onChange={e => setFechaDesde(e.target.value)}
            aria-label="Fecha desde"
            className="w-full md:w-[160px] bg-card"
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            type="date"
            value={fechaHasta}
            min={fechaDesde || undefined}
            onChange={e => setFechaHasta(e.target.value)}
            aria-label="Fecha hasta"
            className="w-full md:w-[160px] bg-card"
          />
          {(fechaDesde || fechaHasta) && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setFechaDesde('');
                setFechaHasta('');
              }}
            >
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]" />
              <TableHead>Tipo</TableHead>
              <TableHead>Fecha emisión</TableHead>
              <TableHead>Período devengado</TableHead>
              <TableHead>Punto / N°</TableHead>
              <TableHead>Contraparte</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map(c => {
              const periodoDiferente = c.periodoDevengado && c.periodoDevengado !== c.fechaEmision.slice(0, 7);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <IconoComprobante direccion={c.direccion} />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">{c.tipo}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span>{c.direccion === 'emitido' ? 'Emitido' : 'Recibido'}</span>
                      {c.esBienPatrimonial && (
                        <Badge variant="muted" className="text-[10px] py-0">
                          <Package className="h-3 w-3" /> Patrimonial
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDate(c.fechaEmision)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {periodoDiferente ? (
                      <Badge variant="warning" className="text-[10px]">
                        {c.periodoDevengado}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground tabular-nums">
                        {c.fechaEmision.slice(0, 7)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums whitespace-nowrap">
                    {c.puntoVenta.toString().padStart(5, '0')}-{c.numero}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{c.contraparteNombre}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatCuit(c.contraparteCuit)}
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums font-medium whitespace-nowrap',
                      c.tipo.includes('Nota Crédito') && 'text-danger',
                    )}
                  >
                    <MontoComprobante c={c} />
                  </TableCell>
                  <TableCell>
                    <BotonPdf c={c} cuit={cliente.cuit} />
                  </TableCell>
                </TableRow>
              );
            })}
            {visibles.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  No hay comprobantes que coincidan con los filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 p-4 lg:hidden">
        {visibles.map(c => {
          const esNC = c.tipo.includes('Nota Crédito');
          const periodoDiferente = c.periodoDevengado && c.periodoDevengado !== c.fechaEmision.slice(0, 7);
          return (
            <Card key={c.id} className="space-y-2 p-4">
              <div className="flex items-start gap-3">
                <IconoComprobante direccion={c.direccion} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-tight">{c.tipo}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>{c.direccion === 'emitido' ? 'Emitido' : 'Recibido'}</span>
                    {c.esBienPatrimonial && (
                      <Badge variant="muted" className="text-[10px] py-0">
                        <Package className="h-3 w-3" /> Patrimonial
                      </Badge>
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    'text-right tabular-nums font-medium text-sm',
                    esNC && 'text-danger',
                  )}
                >
                  <MontoComprobante c={c} />
                </div>
              </div>

              <div className="text-sm">{c.contraparteNombre}</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                <span>{formatDate(c.fechaEmision)}</span>
                <span>
                  {c.puntoVenta.toString().padStart(5, '0')}-{c.numero}
                </span>
                <span>{formatCuit(c.contraparteCuit)}</span>
                {periodoDiferente && (
                  <Badge variant="warning" className="text-[10px]">
                    Dev. {c.periodoDevengado}
                  </Badge>
                )}
                {c.tienePdf && c.cbteTipo && (
                  <div className="ml-auto">
                    <BotonPdf c={c} cuit={cliente.cuit} />
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        {visibles.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            No hay comprobantes que coincidan con los filtros.
          </div>
        )}
      </div>

      {comprobantes.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-border/60 bg-muted/20">
          <span className="text-sm text-muted-foreground tabular-nums">
            {desde + 1}–{Math.min(desde + POR_PAGINA, comprobantes.length)} de{' '}
            {comprobantes.length.toLocaleString('es-AR')} comprobantes
          </span>
          {totalPaginas > 1 && (
            <Paginacion pagina={paginaActual} total={totalPaginas} onChange={setPagina} />
          )}
        </div>
      )}
    </Card>
  );
}

/** Devuelve las páginas a mostrar con elipsis: ej. [1, '…', 4, 5, 6, '…', 153]. */
function rangoPaginas(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const paginas: (number | '…')[] = [1];
  const ini = Math.max(2, actual - 1);
  const fin = Math.min(total - 1, actual + 1);
  if (ini > 2) paginas.push('…');
  for (let p = ini; p <= fin; p++) paginas.push(p);
  if (fin < total - 1) paginas.push('…');
  paginas.push(total);
  return paginas;
}

function Paginacion({
  pagina,
  total,
  onChange,
}: {
  pagina: number;
  total: number;
  onChange: (p: number) => void;
}) {
  return (
    <nav className="flex items-center gap-1" aria-label="Paginación de comprobantes">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={pagina <= 1}
        onClick={() => onChange(pagina - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {rangoPaginas(pagina, total).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1.5 text-muted-foreground select-none" aria-hidden="true">
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === pagina ? 'default' : 'outline'}
            size="icon"
            className="h-8 w-8 tabular-nums"
            aria-label={`Página ${p}`}
            aria-current={p === pagina ? 'page' : undefined}
            onClick={() => onChange(p)}
          >
            {p}
          </Button>
        ),
      )}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={pagina >= total}
        onClick={() => onChange(pagina + 1)}
        aria-label="Página siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
