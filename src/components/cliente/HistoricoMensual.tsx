import { useState } from 'react';
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
import { formatCurrency, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

export function HistoricoMensual({ cliente }: Props) {
  const [vista, setVista] = useState<'ambos' | 'emitidas' | 'recibidas'>('ambos');

  const data = cliente.historialMensual.map(m => ({
    mes: formatMesCorto(m.mes),
    Emitidas: m.emitidasNetas,
    'Ingresos no fact.': m.ingresosNoFacturados,
    Recibidas: m.recibidas,
  }));

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-base font-semibold">Histórico de últimos 13 meses</div>
          <div className="text-sm text-muted-foreground">
            Comprobantes emitidos netos (descontando notas de crédito) e ingresos no facturados marcados por el contador.
          </div>
        </div>
        <Tabs value={vista} onValueChange={(v) => setVista(v as typeof vista)}>
          <TabsList>
            <TabsTrigger value="ambos">Ambos</TabsTrigger>
            <TabsTrigger value="emitidas">Emitidas</TabsTrigger>
            <TabsTrigger value="recibidas">Recibidas</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
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
              formatter={(value: number) => formatCurrency(value)}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
            />
            {(vista === 'ambos' || vista === 'emitidas') && (
              <Bar
                dataKey="Emitidas"
                stackId="emit"
                fill="hsl(var(--primary))"
                radius={[0, 0, 0, 0]}
              />
            )}
            {(vista === 'ambos' || vista === 'emitidas') && (
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

      <div className="mt-6 max-h-80 overflow-auto scrollbar-thin -mx-6 px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mes</TableHead>
              <TableHead className="text-right">Emitidas brutas</TableHead>
              <TableHead className="text-right">NC</TableHead>
              <TableHead className="text-right">Emitidas netas</TableHead>
              <TableHead className="text-right">Ingresos no fact.</TableHead>
              <TableHead className="text-right">Recibidas</TableHead>
              <TableHead className="text-right">Computables ratio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...cliente.historialMensual].reverse().map(m => (
              <TableRow key={m.mes}>
                <TableCell className="font-medium">{formatMesLargo(m.mes)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(m.emitidasBrutas)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {m.notasCredito > 0 ? `-${formatCurrency(m.notasCredito)}` : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(m.emitidasNetas)}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    m.ingresosNoFacturados > 0
                      ? 'text-warning-foreground font-medium'
                      : 'text-muted-foreground',
                  )}
                >
                  {m.ingresosNoFacturados > 0
                    ? formatCurrency(m.ingresosNoFacturados)
                    : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(m.recibidas)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCurrency(m.recibidasComputables)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
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
