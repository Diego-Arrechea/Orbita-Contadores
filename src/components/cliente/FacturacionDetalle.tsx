import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Receipt, CalendarRange, Store, Pencil, Check, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMonto, formatDate, formatCuit, cn } from '@/lib/utils';
import { HOY } from '@/lib/monotributo';
import { etiquetaPuntoVenta, formatPuntoVenta, indicePuntosVenta } from '@/lib/puntosVenta';
import { editarCliente } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import { qkCliente, qkClientes } from '@/lib/queries';
import type { Cliente, Comprobante, PuntoVentaCliente } from '@/types';

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
          {formatMonto(c.montoOrigen ?? c.monto, { moneda: c.moneda })}
        </div>
        {!!c.cotizacion && c.cotizacion !== 1 && (
          <div className="text-[11px] font-normal text-muted-foreground">
            = {neg ? '-' : ''}
            {formatMonto(c.monto)}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {neg ? '-' : ''}
      {formatMonto(c.monto)}
    </>
  );
}

/** Vista del bloque por punto de venta: total del período o desglose mes a mes. */
type VistaPV = 'total' | 'mensual';

/**
 * Nombre de un punto de venta, con edición en el lugar. Muestra el nombre que tenga (el que le puso
 * el contador o el que el cliente tiene registrado); si no hay ninguno, deja el sistema con el que
 * emite como referencia y ofrece ponerle uno. Vaciar el campo borra el nombre propio y vuelve el
 * registrado.
 */
function NombrePuntoVenta({
  cliente,
  nro,
  pv,
}: {
  cliente: Cliente;
  nro: number;
  pv?: PuntoVentaCliente;
}) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(pv?.nombre ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const esReal = cliente.fuente === 'arca';

  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      await editarCliente(cliente.cuit, { puntosVentaNombres: { [nro]: valor.trim() } });
      await qc.invalidateQueries({ queryKey: qkCliente(cliente.cuit) });
      void qc.invalidateQueries({ queryKey: qkClientes });
      setEditando(false);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  if (editando) {
    return (
      <div className="mt-1 space-y-1">
        <div className="flex items-center gap-1">
          <Input
            value={valor}
            onChange={e => setValor(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void guardar();
              if (e.key === 'Escape') setEditando(false);
            }}
            maxLength={60}
            autoFocus
            placeholder="Nombre del punto de venta"
            className="h-7 w-44 text-xs"
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={guardando} onClick={() => void guardar()}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={guardando}
            onClick={() => {
              setValor(pv?.nombre ?? '');
              setEditando(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {error && <div className="text-[11px] text-danger">{error}</div>}
      </div>
    );
  }

  return (
    <div className="group/pv mt-0.5 flex items-center gap-1">
      <span className={cn('text-[11px]', pv?.nombre ? 'text-foreground' : 'text-muted-foreground')}>
        {pv?.nombre ?? pv?.sistema ?? 'Sin nombre'}
      </span>
      {esReal && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          title={pv?.nombre ? 'Cambiar el nombre' : 'Ponerle un nombre'}
          className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover/pv:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
    </div>
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
  const [vistaPV, setVistaPV] = useState<VistaPV>('total');
  // Nombre de cada punto de venta (el del contador gana sobre el registrado), por número.
  const pvIndex = useMemo(() => indicePuntosVenta(cliente), [cliente]);
  const {
    grupos, porPV, pvs, matrizPV, bruto, nc, neto, cant, cantNC, periodo, oficial, manual,
  } = useMemo(() => {
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
    const pvs = porPV.map(p => p.pv);

    // Desglose mes a mes por punto de venta. La ventana va completa (12 meses, el más reciente
    // primero): un mes sin facturación en un punto también es información, así que se muestra.
    const netoMesPV = new Map<string, Map<number, number>>();
    for (const c of emitidos) {
      const k = c.fechaEmision.slice(0, 7);
      let fila = netoMesPV.get(k);
      if (!fila) {
        fila = new Map<number, number>();
        netoMesPV.set(k, fila);
      }
      const signo = esNotaCredito(c) ? -1 : 1;
      fila.set(c.puntoVenta, (fila.get(c.puntoVenta) ?? 0) + signo * c.monto);
    }
    const matrizPV = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(HOY.getFullYear(), HOY.getMonth() - i, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const netos = netoMesPV.get(mes) ?? new Map<number, number>();
      let total = 0;
      for (const v of netos.values()) total += v;
      return { mes, netos, total };
    });

    const oficial =
      cliente.facturacion12mOficial != null && cliente.facturacion12mOficial > 0
        ? cliente.facturacion12mOficial
        : null;

    return {
      grupos,
      porPV,
      pvs,
      matrizPV,
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
            <div className="text-2xl font-semibold tabular-nums">{formatMonto(bruto)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {cant - cantNC} {cant - cantNC === 1 ? 'comprobante' : 'comprobantes'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Notas de crédito</div>
            <div className="text-2xl font-semibold tabular-nums text-danger">
              - {formatMonto(nc)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {cantNC} {cantNC === 1 ? 'nota' : 'notas'}
            </div>
          </div>
          <div className="sm:border-l sm:border-border/60 sm:pl-4">
            <div className="text-xs text-muted-foreground">Facturado neto (base del tope)</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">
              {formatMonto(neto)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{cant} en total</div>
          </div>
        </div>
        {difOficial && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            El total oficial informado para el período es{' '}
            <span className="font-medium text-foreground">{formatMonto(oficial!)}</span>. Puede
            diferir del neto de los comprobantes cargados si incluye operaciones que el contribuyente
            no emite directamente.
          </div>
        )}
        {manual !== 0 && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Incluye{' '}
            <span className="font-medium text-foreground">{formatMonto(manual)}</span> de
            comprobantes cargados a mano.
          </div>
        )}
      </Card>

      {/* Facturación por punto de venta: sólo si el cliente factura desde más de uno (con uno solo el
          desglose sería igual al neto general). Mismo neto = facturas − notas de crédito. Dos vistas:
          el total del período o el detalle mes a mes de cada punto. */}
      {porPV.length > 1 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Store className="h-4 w-4" />
              Facturación por punto de venta
            </div>
            <Tabs value={vistaPV} onValueChange={v => setVistaPV(v as VistaPV)}>
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="total" className="flex-1 sm:flex-none">
                  Total del período
                </TabsTrigger>
                <TabsTrigger value="mensual" className="flex-1 sm:flex-none">
                  Mes a mes
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
          <div className={cn('hidden', vistaPV === 'total' && 'lg:block')}>
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
                    <TableCell className="align-top">
                      <div className="font-medium tabular-nums">{formatPuntoVenta(p.pv)}</div>
                      <NombrePuntoVenta cliente={cliente} nro={p.pv} pv={pvIndex.get(p.pv)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.cant}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMonto(p.neto)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {vistaPV === 'total' && (
            <div className="space-y-2 p-4 lg:hidden">
              {porPV.map(p => (
                <div
                  key={p.pv}
                  className="flex items-center justify-between rounded-xl border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium tabular-nums">
                      Punto {formatPuntoVenta(p.pv)}
                    </div>
                    <NombrePuntoVenta cliente={cliente} nro={p.pv} pv={pvIndex.get(p.pv)} />
                    <div className="text-[11px] text-muted-foreground">
                      {p.cant} {p.cant === 1 ? 'comprobante' : 'comprobantes'}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{formatMonto(p.neto)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Mes a mes: matriz meses × puntos de venta (la tabla scrollea sola si hay muchos). */}
          <div className={cn('hidden', vistaPV === 'mensual' && 'lg:block')}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  {pvs.map(pv => (
                    <TableHead key={pv} className="whitespace-nowrap text-right">
                      <div className="tabular-nums">{formatPuntoVenta(pv)}</div>
                      {pvIndex.get(pv)?.nombre && (
                        <div className="max-w-[9rem] truncate text-[11px] font-normal normal-case text-muted-foreground">
                          {pvIndex.get(pv)!.nombre}
                        </div>
                      )}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrizPV.map(f => (
                  <TableRow key={f.mes}>
                    <TableCell className="whitespace-nowrap font-medium">{mesLargo(f.mes)}</TableCell>
                    {pvs.map(pv => {
                      const v = f.netos.get(pv);
                      return (
                        <TableCell key={pv} className="whitespace-nowrap text-right tabular-nums">
                          {v == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatMonto(v)
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatMonto(f.total)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="whitespace-nowrap font-semibold">Total 12 meses</TableCell>
                  {porPV.map(p => (
                    <TableCell
                      key={p.pv}
                      className="whitespace-nowrap text-right font-semibold tabular-nums"
                    >
                      {formatMonto(p.neto)}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {formatMonto(neto)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {vistaPV === 'mensual' && (
            <div className="space-y-2 p-4 lg:hidden">
              {matrizPV.map(f => (
                <div key={f.mes} className="rounded-xl border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{mesLargo(f.mes)}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMonto(f.total)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {pvs.map(pv => {
                      const v = f.netos.get(pv);
                      return (
                        <div
                          key={pv}
                          className="flex items-center justify-between text-[11px] text-muted-foreground"
                        >
                          <span className="tabular-nums">
                            {etiquetaPuntoVenta(pv, pvIndex.get(pv))}
                          </span>
                          <span className="tabular-nums">{v == null ? '—' : formatMonto(v)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3.5">
            <span className="text-sm font-medium">
              {vistaPV === 'total'
                ? `Total · ${porPV.length} puntos de venta`
                : 'Facturado neto de los últimos 12 meses'}
            </span>
            <span className="text-sm font-semibold tabular-nums">{formatMonto(neto)}</span>
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
                      {formatMonto(g.neto)}
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
                <span className="text-sm font-semibold tabular-nums">{formatMonto(g.neto)}</span>
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
          <span className="text-sm font-semibold tabular-nums">{formatMonto(neto)}</span>
        </div>
      </Card>
    </div>
  );
}
