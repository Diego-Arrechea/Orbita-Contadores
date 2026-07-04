import { Wheat, Loader2, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate, formatCuit } from '@/lib/utils';
import { useLiquidacionesAgro } from '@/lib/queries';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

// Nombre AFIP de cada tipo de liquidación por código (incluye la CLASE A/B/C, que el `tipo_liq` de la
// grilla no distingue: p.ej. 186 y 188 vienen ambos como "Liquidación Compra Directa"). Sector
// Pecuario (hacienda) + Avícola. Fuente: el selector de tipos del propio sistema de AFIP.
const NOMBRE_TIPO_LIQ: Record<number, string> = {
  // Sector Avícola
  157: 'Cuenta de Venta y Líquido Producto A',
  158: 'Cuenta de Venta y Líquido Producto B',
  159: 'Liquidación de Compra A',
  160: 'Liquidación de Compra B',
  161: 'Liquidación de Compra Directa A',
  162: 'Liquidación de Compra Directa B',
  163: 'Liquidación de Compra Directa C',
  164: 'Liquidación de Venta Directa A',
  165: 'Liquidación de Venta Directa B',
  166: 'Contratación de Crianza Pollos Parrilleros A',
  167: 'Contratación de Crianza Pollos Parrilleros B',
  168: 'Contratación de Crianza Pollos Parrilleros C',
  169: 'Crianza Pollos Parrilleros A',
  170: 'Crianza Pollos Parrilleros B',
  // Sector Pecuario (hacienda)
  180: 'Cuenta de Venta y Líquido Producto A',
  182: 'Cuenta de Venta y Líquido Producto B',
  183: 'Liquidación de Compra A',
  185: 'Liquidación de Compra B',
  186: 'Liquidación de Compra Directa A',
  188: 'Liquidación de Compra Directa B',
  189: 'Liquidación de Compra Directa C',
  190: 'Liquidación de Venta Directa A',
  191: 'Liquidación de Venta Directa B',
};

/** Nombre preciso del tipo de la liquidación: el del código (con su clase A/B/C) y, si es un ajuste,
 *  se conserva ese matiz. Cae al `tipo_liq` de la grilla si el código no está mapeado. */
function nombreTipoLiquidacion(l: { cbteTipo: number; tipo: string }): string {
  const base = NOMBRE_TIPO_LIQ[l.cbteTipo] ?? l.tipo ?? `Comprobante ${l.cbteTipo}`;
  const esAjuste = /ajuste/i.test(l.tipo);
  return esAjuste && !/ajuste/i.test(base) ? `${base} (Ajuste)` : base;
}

/** Apartado de Facturación Agropecuaria de la ficha: las liquidaciones del sector primario del
 *  cliente (venta de hacienda, etc.) + su total. Estas liquidaciones se suman a su facturación 12m. */
export function FacturacionAgropecuaria({ cliente }: Props) {
  const { data, isLoading } = useLiquidacionesAgro(cliente.cuit);
  const liquidaciones = data?.liquidaciones ?? [];
  const total = data?.totalBruto ?? 0;
  const total12m = cliente.facturacionAgro12m ?? 0;

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando facturación agropecuaria…
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
            <Wheat className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Facturación agropecuaria</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Liquidaciones del sector primario del cliente (venta de hacienda, etc.). Se suman a su
              facturación de los últimos 12 meses.
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">
              Últimos 12 meses
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">{formatCurrency(total12m)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Sumado a su facturación 12m</div>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Total histórico
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">{formatCurrency(total)}</div>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Liquidaciones
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">{liquidaciones.length}</div>
          </div>
        </div>
      </Card>

      {liquidaciones.length === 0 ? (
        <Card className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <span>
            Todavía no registramos liquidaciones agropecuarias de este cliente. Si acaba de marcarse
            como agropecuario, van a aparecer en cuanto tengamos sus datos.
          </span>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {/* Desktop: tabla */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Punto / N°</TableHead>
                  <TableHead>Contraparte</TableHead>
                  <TableHead className="text-right">Importe bruto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liquidaciones.map(l => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="text-sm font-medium leading-tight">
                        {nombreTipoLiquidacion(l)}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="muted" className="text-[10px] py-0 tabular-nums">
                          Cód. {l.cbteTipo}
                        </Badge>
                        <span>
                          {l.direccion === 'emisor' ? 'Emitida' : 'Recibida'}
                          {l.sistema ? ` · ${l.sistema}` : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {l.fechaComprobante ? formatDate(l.fechaComprobante) : '—'}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums whitespace-nowrap">
                      {l.puntoVenta.toString().padStart(5, '0')}-{l.numero}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {l.contraparteCuit ? formatCuit(l.contraparteCuit) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(l.importeBruto)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: tarjetas */}
          <div className="space-y-3 p-4 lg:hidden">
            {liquidaciones.map(l => (
              <Card key={l.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight">
                      {nombreTipoLiquidacion(l)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="muted" className="text-[10px] py-0 tabular-nums">
                        Cód. {l.cbteTipo}
                      </Badge>
                      <span>
                        {l.direccion === 'emisor' ? 'Emitida' : 'Recibida'}
                        {l.sistema ? ` · ${l.sistema}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums whitespace-nowrap">
                    {formatCurrency(l.importeBruto)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                  <span>{l.fechaComprobante ? formatDate(l.fechaComprobante) : '—'}</span>
                  <span>
                    {l.puntoVenta.toString().padStart(5, '0')}-{l.numero}
                  </span>
                  {l.contraparteCuit && <span>{formatCuit(l.contraparteCuit)}</span>}
                </div>
              </Card>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
