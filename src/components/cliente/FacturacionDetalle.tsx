import { Fragment, useMemo } from 'react';
import { Receipt, CalendarRange, Store } from 'lucide-react';
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
import { formatCurrency, formatDate, formatCuit, cn } from '@/lib/utils';
import { HOY } from '@/lib/monotributo';
import type { Cliente, Comprobante } from '@/types';

interface Props {
  cliente: Cliente;
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
function mesLargo(mes: string) {
  const [y, m] = mes.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}
function mesCorto(d: Date) {
  return d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
}

// Misma detección que el cálculo de facturación (derivarHistorial / backend): por el nombre del tipo.
function esNotaCredito(c: Comprobante) {
  return c.tipo.includes('Nota Crédito');
}

/** Monto del comprobante. En moneda extranjera muestra el original y su equivalente en pesos (que es
 *  el valor canónico que suma al tope). Las notas de crédito van con signo menos. */
function MontoComp({ c }: { c: Comprobante }) {
  const neg = esNotaCredito(c);
  if (c.moneda && c.moneda !== 'ARS') {
    return (
      <>
        <div>
          {neg ? '-' : ''}
          {formatCurrency(c.montoOrigen ?? c.monto, { moneda: c.moneda })}
        </div>
        {!!c.cotizacion && c.cotizacion !== 1 && (
          <div className="text-[11px] font-normal text-muted-foreground">
            = {neg ? '-' : ''}
            {formatCurrency(c.monto)}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {neg ? '-' : ''}
      {formatCurrency(c.monto)}
    </>
  );
}

/**
 * Detalle de la facturación de los últimos 12 meses: lista todos los comprobantes EMITIDOS que
 * componen el número, agrupados por mes, con la reconciliación bruto − notas de crédito = neto.
 *
 * Replica EXACTAMENTE el criterio del cálculo de facturación (ver `derivarHistorial` y `_historial_12m`
 * en el backend): emitidos con fecha desde el primer día de hace 12 meses calendario; las facturas
 * suman y las notas de crédito restan. Así lo que se lista cuadra con el total que se muestra en la
 * situación del cliente.
 */
export function FacturacionDetalle({ cliente }: Props) {
  const { grupos, porPV, bruto, nc, neto, cant, cantNC, periodo, oficial, manual } = useMemo(() => {
    // Ventana: primer día del mes de hace 11 meses (= 12 meses calendario contando el actual).
    const inicio = new Date(HOY.getFullYear(), HOY.getMonth() - 11, 1);
    const fin = new Date(HOY.getFullYear(), HOY.getMonth(), 1);
    const desdeStr = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;

    const emitidos = cliente.comprobantes
      .filter(c => c.direccion === 'emitido' && c.fechaEmision >= desdeStr)
      .sort(
        (a, b) =>
          b.fechaEmision.localeCompare(a.fechaEmision) ||
          b.puntoVenta - a.puntoVenta ||
          b.numero.localeCompare(a.numero),
      );

    let bruto = 0;
    let nc = 0;
    let cantNC = 0;
    let manual = 0; // parte neta que viene de comprobantes cargados a mano
    for (const c of emitidos) {
      if (esNotaCredito(c)) {
        nc += c.monto;
        cantNC++;
        if (c.origen === 'manual') manual -= c.monto;
      } else {
        bruto += c.monto;
        if (c.origen === 'manual') manual += c.monto;
      }
    }

    const map = new Map<string, Comprobante[]>();
    for (const c of emitidos) {
      const k = c.fechaEmision.slice(0, 7);
      const arr = map.get(k);
      if (arr) arr.push(c);
      else map.set(k, [c]);
    }
    const grupos = [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a)) // meses más recientes primero
      .map(([mes, comps]) => {
        let b2 = 0;
        let n2 = 0;
        for (const c of comps) {
          if (esNotaCredito(c)) n2 += c.monto;
          else b2 += c.monto;
        }
        return { mes, comps, neto: b2 - n2 };
      });

    // Totales por punto de venta (para "totalizar los distintos puntos de venta"): mismo criterio que
    // el neto general (facturas suman, notas de crédito restan), pero agrupado por punto de venta.
    const pvMap = new Map<number, { bruto: number; nc: number; cant: number }>();
    for (const c of emitidos) {
      const e = pvMap.get(c.puntoVenta) ?? { bruto: 0, nc: 0, cant: 0 };
      if (esNotaCredito(c)) e.nc += c.monto;
      else e.bruto += c.monto;
      e.cant++;
      pvMap.set(c.puntoVenta, e);
    }
    const porPV = [...pvMap.entries()]
      .map(([pv, v]) => ({ pv, cant: v.cant, neto: v.bruto - v.nc }))
      .sort((a, b) => a.pv - b.pv);

    const oficial =
      cliente.facturacion12mOficial != null && cliente.facturacion12mOficial > 0
        ? cliente.facturacion12mOficial
        : null;

    return {
      grupos,
      porPV,
      bruto,
      nc,
      neto: bruto - nc,
      cant: emitidos.length,
      cantNC,
      periodo: `${mesCorto(inicio)} – ${mesCorto(fin)}`,
      oficial,
      manual,
    };
  }, [cliente.comprobantes, cliente.facturacion12mOficial]);

  if (cant === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Receipt className="h-6 w-6" />
        </div>
        <div className="text-base font-medium">Sin comprobantes emitidos en los últimos 12 meses</div>
        <div className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
          Cuando este cliente tenga comprobantes emitidos en el período, vas a ver acá cada uno y cómo
          suman a su facturación.
        </div>
      </Card>
    );
  }

  const difOficial = oficial != null && Math.abs(oficial - neto) > 1;

  return (
    <div className="space-y-5">
      {/* Encabezado: reconciliación bruto − NC = neto */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <CalendarRange className="h-4 w-4" />
          Facturación de los últimos 12 meses · {periodo}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Facturado bruto</div>
            <div className="text-2xl font-semibold tabular-nums">{formatCurrency(bruto)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {cant - cantNC} {cant - cantNC === 1 ? 'comprobante' : 'comprobantes'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Notas de crédito</div>
            <div className="text-2xl font-semibold tabular-nums text-danger">
              - {formatCurrency(nc)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {cantNC} {cantNC === 1 ? 'nota' : 'notas'}
            </div>
          </div>
          <div className="sm:border-l sm:border-border/60 sm:pl-4">
            <div className="text-xs text-muted-foreground">Facturado neto (base del tope)</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">
              {formatCurrency(neto)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{cant} en total</div>
          </div>
        </div>
        {difOficial && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            El total oficial informado para el período es{' '}
            <span className="font-medium text-foreground">{formatCurrency(oficial!)}</span>. Puede
            diferir del neto de los comprobantes cargados si incluye operaciones que el contribuyente
            no emite directamente.
          </div>
        )}
        {manual !== 0 && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Incluye{' '}
            <span className="font-medium text-foreground">{formatCurrency(manual)}</span> de
            comprobantes cargados a mano.
          </div>
        )}
      </Card>

      {/* Totales por punto de venta: sólo si el cliente factura desde más de uno (con uno solo el
          desglose sería igual al neto general). Mismo neto = facturas − notas de crédito. */}
      {porPV.length > 1 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 px-5 pt-5 text-xs uppercase tracking-wider text-muted-foreground">
            <Store className="h-4 w-4" />
            Totales por punto de venta
          </div>
          {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Punto de venta</TableHead>
                  <TableHead className="text-right">Comprobantes</TableHead>
                  <TableHead className="text-right">Facturado neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porPV.map(p => (
                  <TableRow key={p.pv}>
                    <TableCell className="font-medium tabular-nums">
                      {p.pv.toString().padStart(5, '0')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.cant}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(p.neto)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2 p-4 lg:hidden">
            {porPV.map(p => (
              <div
                key={p.pv}
                className="flex items-center justify-between rounded-xl border border-border/60 p-3"
              >
                <div>
                  <div className="text-sm font-medium tabular-nums">
                    Punto {p.pv.toString().padStart(5, '0')}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.cant} {p.cant === 1 ? 'comprobante' : 'comprobantes'}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">{formatCurrency(p.neto)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3.5">
            <span className="text-sm font-medium">
              Total · {porPV.length} puntos de venta
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatCurrency(neto)}</span>
          </div>
        </Card>
      )}

      {/* Detalle por mes */}
      <Card className="overflow-hidden">
        {/* Escritorio: tabla agrupada por mes. */}
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Punto / N°</TableHead>
                <TableHead>Contraparte</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.map(g => (
                <Fragment key={g.mes}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="text-sm font-semibold">
                      {mesLargo(g.mes)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(g.neto)}
                    </TableCell>
                  </TableRow>
                  {g.comps.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                          {c.tipo}
                          {c.origen === 'manual' && (
                            <Badge variant="secondary" className="text-[10px] py-0">
                              A mano
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(c.fechaEmision)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
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
                          'whitespace-nowrap text-right font-medium tabular-nums',
                          esNotaCredito(c) && 'text-danger',
                        )}
                      >
                        <MontoComp c={c} />
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile (< lg): tarjetas apiladas por mes. */}
        <div className="space-y-4 p-4 lg:hidden">
          {grupos.map(g => (
            <div key={g.mes}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{mesLargo(g.mes)}</span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(g.neto)}</span>
              </div>
              <div className="space-y-2">
                {g.comps.map(c => (
                  <div key={c.id} className="rounded-xl border border-border/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          {c.tipo}
                          {c.origen === 'manual' && (
                            <Badge variant="secondary" className="text-[10px] py-0">
                              A mano
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{c.contraparteNombre}</div>
                      </div>
                      <div
                        className={cn(
                          'text-right text-sm font-medium tabular-nums',
                          esNotaCredito(c) && 'text-danger',
                        )}
                      >
                        <MontoComp c={c} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                      <span>{formatDate(c.fechaEmision)}</span>
                      <span>
                        {c.puntoVenta.toString().padStart(5, '0')}-{c.numero}
                      </span>
                      <span>{formatCuit(c.contraparteCuit)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Total general del período */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3.5">
          <span className="text-sm font-medium">Facturado neto del período</span>
          <span className="text-sm font-semibold tabular-nums">{formatCurrency(neto)}</span>
        </div>
      </Card>
    </div>
  );
}
