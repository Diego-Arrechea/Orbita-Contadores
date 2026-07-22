import { Landmark, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import type { Cliente, Facilidad } from '@/types';

interface Props {
  cliente: Cliente;
}

/** Etiqueta de la situación del plan. `caduco` = se cayó (deuda de vuelta); `vigente` = activo. */
function situacionBadge(f: Facilidad) {
  const s = (f.situacion || '').toLowerCase();
  if (f.vigente || s.includes('vigente')) return <Badge variant="success">Vigente</Badge>;
  if (s.includes('caduc')) return <Badge variant="danger">Caduco</Badge>;
  if (s.includes('cancel')) return <Badge variant="muted">Cancelado</Badge>;
  return <Badge variant="muted">{f.situacion || '—'}</Badge>;
}

export function PlanesFacilidades({ cliente }: Props) {
  const planes = cliente.facilidades ?? [];
  const vigentes = planes.filter(p => p.vigente).length;
  const caducos = planes.filter(p => (p.situacion || '').toLowerCase().includes('caduc')).length;
  const otros = planes.length - vigentes - caducos;

  if (planes.length === 0) {
    return (
      <Card className="p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Sin planes de facilidades</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              Este cliente no tiene planes de facilidades de pago registrados.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-7">
      <div className="flex items-center gap-2 mb-1">
        <Landmark className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Planes de facilidades de pago</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Planes con los que el cliente financió deuda con ARCA, y su estado.
      </p>

      {/* Resumen */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
          <span className="font-semibold tabular-nums">{vigentes}</span>{' '}
          <span className="text-muted-foreground">vigentes</span>
        </div>
        {caducos > 0 && (
          <div className="rounded-lg bg-danger/12 border border-danger/25 px-3 py-1.5 text-sm">
            <span className="font-semibold tabular-nums text-danger">{caducos}</span>{' '}
            <span className="text-danger/90">caducos</span>
          </div>
        )}
        {otros > 0 && (
          <div className="rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
            <span className="font-semibold tabular-nums">{otros}</span>{' '}
            <span className="text-muted-foreground">otros</span>
          </div>
        )}
      </div>

      {caducos > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-danger/12 border border-danger/25 px-3 py-2.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-danger shrink-0" />
          <span>
            Tiene {caducos === 1 ? 'un plan caduco' : `${caducos} planes caducos`}: la deuda financiada
            volvió a estar activa.
          </span>
        </div>
      )}

      {/* Tabla (desktop) */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-medium">Plan</th>
              <th className="py-2 px-3 font-medium">Tipo</th>
              <th className="py-2 px-3 font-medium text-right">Total</th>
              <th className="py-2 px-3 font-medium text-center">Cuotas</th>
              <th className="py-2 pl-3 font-medium">Situación</th>
            </tr>
          </thead>
          <tbody>
            {planes.map((p, i) => (
              <tr key={`${p.nro}-${i}`} className="border-b border-border/60">
                <td className="py-2.5 pr-3 font-medium tabular-nums">{p.nro}</td>
                <td className="py-2.5 px-3 text-muted-foreground max-w-[280px] truncate" title={p.tipo}>
                  {p.tipo || '—'}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {p.total != null ? formatCurrency(p.total) : '—'}
                </td>
                <td className="py-2.5 px-3 text-center tabular-nums text-muted-foreground">
                  {p.cuotasTotal ?? '—'}
                </td>
                <td className="py-2.5 pl-3">{situacionBadge(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas (mobile) */}
      <div className="lg:hidden space-y-3">
        {planes.map((p, i) => (
          <div key={`${p.nro}-${i}`} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium tabular-nums">{p.nro}</span>
              {situacionBadge(p)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">{p.tipo || '—'}</div>
            <div className="mt-2 flex items-center gap-4 text-sm">
              <span className="tabular-nums">{p.total != null ? formatCurrency(p.total) : '—'}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.cuotasTotal != null ? `${p.cuotasTotal} cuotas` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
