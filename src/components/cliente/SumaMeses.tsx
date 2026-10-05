import { Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CATEGORIAS, getCategoria } from '@/data/categorias';
import { formatMonto, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

/** Un mes tildado: lo facturado (emitidas netas) y los ingresos no facturados marcados a mano. */
export interface MesSumable {
  periodo: string;
  emit: number;
  ing: number;
}

/**
 * Suma de los meses que el contador tilda en el histórico: total, promedio mensual y, para un
 * monotributista, cuánto margen le queda contra el tope de su categoría y qué categoría le
 * correspondería al ritmo de esos meses. Pedido de los contadores (reunión 1-oct-2026): proyectar
 * la facturación y avisarle al cliente cuánto puede facturar sin pasarse antes de recategorizar.
 *
 * El tope es el mismo que usa el resto de la ficha (el oficial de su categoría si lo tenemos, si no
 * la escala vigente). La suma sale de los comprobantes del período, en valores nominales: con
 * "pesos de hoy" se muestran suma y promedio, pero no se compara contra el tope (es por nominales).
 */
export function SumaMeses({
  cliente,
  meses,
  nominal,
  hayIngresos,
  onUltimos12,
  onTodos,
  onLimpiar,
}: {
  cliente: Cliente;
  meses: MesSumable[];
  nominal: boolean;
  hayIngresos: boolean;
  onUltimos12: () => void;
  onTodos: () => void;
  onLimpiar: () => void;
}) {
  const n = meses.length;
  const emit = meses.reduce((s, m) => s + m.emit, 0);
  const ing = meses.reduce((s, m) => s + m.ing, 0);
  const suma = emit + ing;
  const promedio = n ? suma / n : 0;

  const esMonotributo = cliente.regimen === 'monotributo' || (!cliente.regimen && !!cliente.categoria);
  const categoria = cliente.categoria ? getCategoria(cliente.categoria) : null;
  const tope =
    cliente.topeCategoriaOficial && cliente.topeCategoriaOficial > 0
      ? cliente.topeCategoriaOficial
      : categoria?.topeAnual ?? 0;
  const conTope = nominal && esMonotributo && tope > 0 && n > 0;
  const restante = tope - suma;
  const faltan = Math.max(0, 12 - n);
  const anualizado = promedio * 12;
  const corresponde = CATEGORIAS.find(c => anualizado <= c.topeAnual);

  const botones = (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onUltimos12}>
        Últimos 12 meses
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onTodos}>
        Todos
      </Button>
      {n > 0 && (
        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={onLimpiar}>
          Limpiar
        </Button>
      )}
    </div>
  );

  if (n === 0) {
    return (
      <div className="mt-4 flex flex-col gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <Calculator className="h-4 w-4 shrink-0" />
          Tildá meses en la tabla para ver la suma, el promedio y el margen contra el tope.
        </span>
        {botones}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Calculator className="h-4 w-4 text-primary" />
          {n} {n === 1 ? 'mes seleccionado' : 'meses seleccionados'}
        </div>
        {botones}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato
          label="Suma"
          valor={formatMonto(suma)}
          detalle={hayIngresos && ing > 0 ? `${formatMonto(emit)} facturado + ${formatMonto(ing)} no facturado` : undefined}
        />
        <Dato label="Promedio mensual" valor={formatMonto(promedio)} />
        {conTope && (
          <Dato
            label={`Tope categoría ${categoria?.codigo ?? ''}`.trim()}
            valor={formatMonto(tope)}
            detalle={restante >= 0 ? `Margen: ${formatMonto(restante)}` : `Lo supera por ${formatMonto(-restante)}`}
            tono={restante >= 0 ? undefined : 'danger'}
          />
        )}
        {conTope && faltan > 0 && (
          <Dato
            label={`Puede facturar por mes (${faltan} ${faltan === 1 ? 'mes restante' : 'meses restantes'})`}
            valor={restante > 0 ? formatMonto(restante / faltan) : formatMonto(0)}
            detalle={
              restante > 0
                ? 'Para completar 12 meses sin pasar el tope'
                : 'Con estos meses ya alcanzó el tope de la categoría'
            }
            tono={restante > 0 ? 'success' : 'danger'}
          />
        )}
      </div>

      {conTope && (
        <p className="mt-3 text-xs text-muted-foreground">
          Al ritmo de estos meses (promedio × 12 = {formatMonto(anualizado)})
          {corresponde ? (
            <>
              {' '}le correspondería la{' '}
              <span
                className={cn(
                  'font-medium',
                  categoria && corresponde.codigo !== categoria.codigo
                    ? corresponde.topeAnual > categoria.topeAnual
                      ? 'text-warning-foreground'
                      : 'text-success'
                    : 'text-foreground',
                )}
              >
                categoría {corresponde.codigo}
              </span>
              {categoria && corresponde.codigo === categoria.codigo ? ', la misma que tiene hoy.' : '.'}
            </>
          ) : (
            <span className="font-medium text-danger"> superaría el tope de la categoría más alta.</span>
          )}
        </p>
      )}
      {!nominal && esMonotributo && (
        <p className="mt-3 text-xs text-muted-foreground">
          Montos ajustados por inflación (referencia). Para comparar contra el tope, pasá a «Nominal».
        </p>
      )}
    </div>
  );
}

function Dato({
  label,
  valor,
  detalle,
  tono,
}: {
  label: string;
  valor: string;
  detalle?: string;
  tono?: 'success' | 'danger';
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tabular-nums',
          tono === 'success' && 'text-success',
          tono === 'danger' && 'text-danger',
        )}
      >
        {valor}
      </div>
      {detalle && <div className="text-xs text-muted-foreground">{detalle}</div>}
    </div>
  );
}
