import { useState, useMemo, useEffect } from 'react';
import { FileText, Search, Package, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
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

export function ListaComprobantes({ cliente }: Props) {
  const [direccion, setDireccion] = useState<'todos' | 'emitido' | 'recibido'>('todos');
  const [tipo, setTipo] = useState<TipoFiltro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);

  const comprobantes = useMemo(
    () =>
      cliente.comprobantes
        .filter(c => (direccion === 'todos' ? true : c.direccion === direccion))
        .filter(c => coincideTipo(c.tipo, tipo))
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
    [cliente.comprobantes, direccion, tipo, busqueda],
  );

  // Al cambiar los filtros, volver a la primera página.
  useEffect(() => setPagina(1), [direccion, tipo, busqueda]);

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
          <SelectTrigger className="w-[160px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="emitido">Emitidos</SelectItem>
            <SelectItem value="recibido">Recibidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-[180px] bg-card">
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
      </div>

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
            const esNC = c.tipo.includes('Nota Crédito');
            const periodoDiferente = c.periodoDevengado && c.periodoDevengado !== c.fechaEmision.slice(0, 7);
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg',
                      c.direccion === 'emitido'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <FileText className="h-4 w-4" />
                  </div>
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
                    esNC && 'text-danger',
                  )}
                >
                  {c.moneda && c.moneda !== 'ARS' ? (
                    // Comprobante en moneda extranjera (p.ej. Factura E de exportación): se muestra
                    // en su moneda original + la cotización del día. El tope se consolida en pesos.
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
                  ) : (
                    <>
                      {esNC ? '-' : ''}
                      {formatCurrency(c.monto)}
                    </>
                  )}
                </TableCell>
                <TableCell>
                  {/* "Ver PDF": pendiente. ARCA no expone una URL al PDF del comprobante (todo va
                      detrás de la clave fiscal) y no cacheamos PDFs. Lo dejamos deshabilitado hasta
                      implementar la descarga on-demand. El <span> recibe el hover: el Button disabled
                      tiene pointer-events-none y, sin él, el tooltip no aparecería. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled
                          aria-label="Ver PDF (próximamente)"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Ver PDF — próximamente</TooltipContent>
                  </Tooltip>
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
