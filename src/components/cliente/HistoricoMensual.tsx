import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatMonto, cn } from '@/lib/utils';
import { VerDetalle } from '@/components/cliente/VerDetalle';
import { detalleHistorico } from '@/lib/trazabilidad';
import { useHistorico } from '@/lib/queries';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
  /** Cliente real (backend): habilita el rango histórico y el ajuste por inflación. En el mock se
   *  cae al historial embebido (mensual, nominal). */
  real?: boolean;
}

type Rango = 12 | 24 | 60 | 999;
type Unidad = 'nominal' | 'hoy';
type Fila = { periodo: string; emit: number; recib: number; ing: number };

export function HistoricoMensual({ cliente, real = true }: Props) {
  const [vista, setVista] = useState<'ambos' | 'emitidas' | 'recibidas'>('ambos');
  const [rango, setRango] = useState<Rango>(12);
  const [unidad, setUnidad] = useState<Unidad>('nominal');

  // Sólo clientes reales tienen histórico/ajuste; el tab se monta al abrirlo, así que la consulta es
  // efectivamente perezosa. El mock usa el historial embebido.
  const { data: hist, isFetching } = useHistorico(cliente.cuit, rango, real);
  const usaEndpoint = real && !!hist;
  const esAnio = usaEndpoint && hist!.agrupacion === 'anio';

  // Ingresos no facturados marcados por el contador (viven en el historial embebido, por mes). Sólo
  // tienen sentido en la vista mensual y en valores nominales.
  const ingPorMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of cliente.historialMensual) m.set(h.mes, h.ingresosNoFacturados || 0);
    return m;
  }, [cliente.historialMensual]);

  const filas: Fila[] = useMemo(() => {
    if (usaEndpoint) {
      const conIng = !esAnio && unidad === 'nominal';
      return hist!.periodos.map(p => ({
        periodo: p.periodo,
        emit: unidad === 'hoy' ? p.emitidasNetasReal : p.emitidasNetas,
        recib: unidad === 'hoy' ? p.recibidasReal : p.recibidas,
        ing: conIng ? ingPorMes.get(p.periodo) || 0 : 0,
      }));
    }
    // Fallback embebido (mock, o mientras carga la primera vez): mensual, nominal, últimos `rango`.
    const meses = cliente.historialMensual;
    const corte = rango >= 900 ? 0 : Math.max(0, meses.length - rango);
    return meses.slice(corte).map(h => ({
      periodo: h.mes,
      emit: h.emitidasNetas,
      recib: h.recibidas,
      ing: h.ingresosNoFacturados || 0,
    }));
  }, [usaEndpoint, hist, esAnio, unidad, ingPorMes, cliente.historialMensual, rango]);

  const hayIngresos = filas.some(f => f.ing > 0);
  const data = filas.map(f => ({
    periodo: formatPeriodoCorto(f.periodo, esAnio),
    Emitidas: f.emit,
    'Ingresos no fact.': f.ing,
    Recibidas: f.recib,
  }));

  const refCorto = hist ? formatMesCorto(hist.mesReferencia) : '';
  const rangoTxt =
    rango >= 900 ? 'todo el período' : rango === 60 ? 'últimos 5 años' : `últimos ${rango} meses`;
  const desdeTxt =
    (rango === 60 || rango >= 900) && hist?.primerPeriodo
      ? ` · desde ${formatMesLargo(hist.primerPeriodo)}`
      : '';
  const totalMostrado = filas.reduce((s, f) => s + (vista === 'recibidas' ? f.recib : f.emit), 0);

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-4">
        <div>
          <div className="text-base font-semibold inline-flex items-center gap-1.5">
            Facturación histórica
            <VerDetalle detalle={detalleHistorico} />
          </div>
          <div className="text-sm text-muted-foreground">
            {esAnio ? 'Por año' : 'Por mes'} · {rangoTxt}
            {desdeTxt}
          </div>
        </div>
        <Tabs value={vista} onValueChange={(v) => setVista(v as typeof vista)}>
          <TabsList className="w-full lg:w-auto">
            <TabsTrigger value="ambos" className="flex-1 lg:flex-none">Ambos</TabsTrigger>
            <TabsTrigger value="emitidas" className="flex-1 lg:flex-none">Emitidas</TabsTrigger>
            <TabsTrigger value="recibidas" className="flex-1 lg:flex-none">Recibidas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {real && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
          <Tabs value={String(rango)} onValueChange={(v) => setRango(Number(v) as Rango)}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="12" className="flex-1 sm:flex-none">12 meses</TabsTrigger>
              <TabsTrigger value="24" className="flex-1 sm:flex-none">24 meses</TabsTrigger>
              <TabsTrigger value="60" className="flex-1 sm:flex-none">5 años</TabsTrigger>
              <TabsTrigger value="999" className="flex-1 sm:flex-none">Todo</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={unidad} onValueChange={(v) => setUnidad(v as Unidad)}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="nominal" className="flex-1 sm:flex-none">Nominal</TabsTrigger>
              <TabsTrigger value="hoy" className="flex-1 sm:flex-none">Pesos de hoy</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="periodo"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
              minTickGap={esAnio ? 0 : 8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(v) => formatCurrency(v, { compact: true })}
            />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number) => formatMonto(value)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            {(vista === 'ambos' || vista === 'emitidas') && (
              <Bar
                dataKey="Emitidas"
                stackId="emit"
                fill="hsl(var(--primary))"
                radius={hayIngresos ? [0, 0, 0, 0] : [6, 6, 0, 0]}
              />
            )}
            {(vista === 'ambos' || vista === 'emitidas') && hayIngresos && (
              <Bar
                dataKey="Ingresos no fact."
                stackId="emit"
                fill="hsl(var(--warning))"
                radius={[6, 6, 0, 0]}
              />
            )}
            {(vista === 'ambos' || vista === 'recibidas') && (
              <Bar
                dataKey="Recibidas"
                fill="hsl(var(--muted-foreground))"
                radius={[6, 6, 0, 0]}
                opacity={0.45}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {vista === 'recibidas' ? 'Compras' : 'Facturado'} acumulado: {formatMonto(totalMostrado)}
        </span>
        {real && (
          <span>
            {unidad === 'hoy'
              ? `Ajustado por inflación${refCorto ? ` — pesos de ${refCorto}` : ''}. Cifra de referencia.`
              : 'Valores nominales de cada período.'}
            {isFetching ? ' · Actualizando…' : ''}
          </span>
        )}
      </div>

      {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
      <div className="mt-6 hidden max-h-80 overflow-auto scrollbar-thin -mx-6 px-6 lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{esAnio ? 'Año' : 'Mes'}</TableHead>
              <TableHead className="text-right">Emitidas netas</TableHead>
              {hayIngresos && <TableHead className="text-right">Ingresos no fact.</TableHead>}
              <TableHead className="text-right">Recibidas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...filas].reverse().map(f => (
              <TableRow key={f.periodo}>
                <TableCell className="font-medium">{formatPeriodoLargo(f.periodo, esAnio)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatMonto(f.emit)}
                </TableCell>
                {hayIngresos && (
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      f.ing > 0 ? 'text-warning-foreground font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {f.ing > 0 ? formatMonto(f.ing) : '—'}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatMonto(f.recib)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-5 space-y-3 lg:hidden">
        {[...filas].reverse().map(f => (
          <div key={f.periodo} className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{formatPeriodoLargo(f.periodo, esAnio)}</span>
              <span className="text-sm tabular-nums font-medium">
                {formatMonto(f.emit)}{' '}
                <span className="text-xs font-normal text-muted-foreground">emitidas</span>
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {hayIngresos && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ing. no fact.</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      f.ing > 0 ? 'text-warning-foreground font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {f.ing > 0 ? formatMonto(f.ing) : '—'}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recibidas</span>
                <span className="tabular-nums">{formatMonto(f.recib)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function formatPeriodoCorto(periodo: string, esAnio: boolean) {
  return esAnio ? periodo : formatMesCorto(periodo);
}

function formatPeriodoLargo(periodo: string, esAnio: boolean) {
  return esAnio ? periodo : formatMesLargo(periodo);
}

function formatMesCorto(mes: string) {
  const [y, m] = mes.split('-');
  const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${nombres[Number(m) - 1]} ${y.slice(2)}`;
}

function formatMesLargo(mes: string) {
  const [y, m] = mes.split('-');
  const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${nombres[Number(m) - 1]} ${y}`;
}
