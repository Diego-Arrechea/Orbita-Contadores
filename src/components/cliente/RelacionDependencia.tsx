import { Briefcase, Info } from 'lucide-react';
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
import { formatCurrency, formatPercent } from '@/lib/utils';
import type { CalculoCliente } from '@/lib/monotributo';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
  calc: CalculoCliente;
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** 'aaaamm' -> 'Mmm/aaaa' (p.ej. '202512' -> 'Dic/2025'). */
function periodoLabel(aaaamm: string): string {
  const anio = aaaamm.slice(0, 4);
  const mes = Number(aaaamm.slice(4, 6));
  return `${MESES[mes - 1] ?? mes}/${anio}`;
}

/** Apartado de Relación de dependencia de la ficha: empleador(es) + remuneración mes a mes del haber
 *  percibido + cuánto de las compras a consumidor final queda respaldada por ese haber. */
export function RelacionDependencia({ cliente, calc }: Props) {
  const rem = cliente.remuneracion;

  if (!rem) {
    return (
      <Card className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>
          Este cliente figura en relación de dependencia, pero todavía no tenemos el detalle de su
          remuneración. Va a aparecer en cuanto tengamos sus datos.
        </span>
      </Card>
    );
  }

  const compras = calc.comprasUltimos12;
  const cubierto = compras > 0 ? Math.min(1, rem.totalBruto / compras) : 1;
  const restante = Math.max(0, compras - rem.totalBruto);
  const meses = [...rem.meses].sort((a, b) => a.periodo.localeCompare(b.periodo));

  return (
    <div className="space-y-5">
      {/* Resumen */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary shrink-0">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Relación de dependencia</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Remuneración percibida en relación de dependencia. El haber percibido respalda parte de
              las compras a consumidor final, aunque no estén vinculadas a la actividad.
            </div>
          </div>
        </div>

        {rem.empleadores.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              {rem.empleadores.length > 1 ? 'Empleadores' : 'Empleador'}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {rem.empleadores.map((e) => (
                <Badge key={e} variant="muted" className="text-[11px]">
                  {e}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-primary font-semibold">
              Haber percibido 12m
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">
              {formatCurrency(rem.totalBruto)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Remuneración bruta informada</div>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Compras 12m
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">{formatCurrency(compras)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">A consumidor final</div>
          </div>
          <div className="rounded-xl border border-border/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              Respaldo de gastos
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">
              {formatPercent(cubierto, 0)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {restante > 0 ? `${formatCurrency(restante)} sin cubrir` : 'Cubre todas las compras'}
            </div>
          </div>
        </div>
      </Card>

      {/* Detalle mensual */}
      {meses.length > 0 && (
        <Card className="overflow-hidden p-0">
          {/* Desktop: tabla */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Remuneración bruta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meses.map((m) => (
                  <TableRow key={m.periodo}>
                    <TableCell className="text-sm">
                      {periodoLabel(m.periodo)}
                      {m.incluyeSac && (
                        <Badge variant="muted" className="ml-2 text-[10px] py-0">
                          incluye SAC
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatCurrency(m.bruto)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: lista */}
          <div className="divide-y divide-border/60 lg:hidden">
            {meses.map((m) => (
              <div key={m.periodo} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span className="text-sm">
                  {periodoLabel(m.periodo)}
                  {m.incluyeSac && (
                    <Badge variant="muted" className="ml-2 text-[10px] py-0">
                      SAC
                    </Badge>
                  )}
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(m.bruto)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
