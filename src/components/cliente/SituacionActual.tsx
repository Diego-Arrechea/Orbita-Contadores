import { TrendingUp, AlertCircle, CalendarClock, CreditCard, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgresoTope } from '@/components/shared/ProgresoTope';
import { formatCurrency, formatDate, formatPercent } from '@/lib/utils';
import { getCategoria } from '@/data/categorias';
import type { CalculoCliente } from '@/lib/monotributo';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
  calc: CalculoCliente;
}

export function SituacionActual({ cliente, calc }: Props) {
  const categoriaActual = getCategoria(cliente.categoria);
  const debeRecategorizar = calc.categoriaCorresponde.codigo !== cliente.categoria;
  const ratioPct = calc.ratioGastosTopeCatK;
  const ratioUmbralStr = formatPercent(calc.ratioUmbralLegal);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card className="p-7 col-span-full lg:col-span-2">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Facturación últimos 12 meses
              {calc.mesesConActividad < 12 && (
                <span className="ml-2 text-warning-foreground normal-case tracking-normal">
                  (anualizada con {calc.mesesConActividad}m de actividad)
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <div className="text-4xl font-semibold tabular-nums tracking-tight">
                {formatCurrency(
                  calc.mesesConActividad < 12
                    ? calc.facturacionUltimos12Anualizada
                    : calc.facturacionUltimos12,
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                / {formatCurrency(categoriaActual.topeAnual)}
              </div>
            </div>
          </div>
          <Badge variant="outline" className="font-semibold">
            Cat. {cliente.categoria}
          </Badge>
        </div>

        <ProgresoTope porcentaje={calc.porcentajeTopeActual} showLabel={false} />

        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted-foreground">
            {formatPercent(calc.porcentajeTopeActual, 1)} consumido
          </span>
          {calc.fechaProyectadaCruceTope && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Proyección cruce: {formatDate(calc.fechaProyectadaCruceTope, 'long')}
            </span>
          )}
        </div>

        {debeRecategorizar && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-warning/15 border border-warning/30 px-3 py-2.5 text-sm">
            <TrendingUp className="h-4 w-4 text-warning-foreground" />
            <span>Con la facturación actual debería recategorizarse a</span>
            <Badge variant="warning" className="font-semibold">
              Cat. {calc.categoriaCorresponde.codigo}
            </Badge>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            <span className="text-muted-foreground tabular-nums">
              {formatCurrency(calc.categoriaCorresponde.topeAnual)}
            </span>
          </div>
        )}
      </Card>

      <Card className="p-7">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Próxima ventana
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-semibold tabular-nums">
            {Number.isFinite(calc.diasParaProximaVentana) ? calc.diasParaProximaVentana : '—'}
          </div>
          <div className="text-sm text-muted-foreground">días</div>
        </div>
        {calc.proximaVentana && (
          <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Vence el {formatDate(calc.proximaVentana.fechaLimite, 'long')}
            <br />
            <span className="text-muted-foreground/80">
              Semestre {calc.proximaVentana.semestre}
            </span>
          </div>
        )}
      </Card>

      <Card className="p-7">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Ratio compras / tope K
          </div>
          {calc.ratioSuperadoLegal && (
            <Badge variant="danger" className="text-[10px]">
              superado
            </Badge>
          )}
        </div>
        <div className="text-4xl font-semibold tabular-nums tracking-tight">
          {formatPercent(ratioPct, 1)}
        </div>
        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Umbral legal {cliente.tipoActividad}: <span className="font-medium">{ratioUmbralStr}</span>
          <br />
          Compras / ventas propias: {formatPercent(calc.ratioGastosVentas, 0)}
        </div>
      </Card>

      <Card className="p-7">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Proyección con inflación
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-4xl font-semibold tabular-nums tracking-tight">
            Cat. {calc.categoriaConInflacion.codigo}
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Estimación a 12 meses con margen conservador del 5%.
          {calc.categoriaConInflacion.codigo !== cliente.categoria && (
            <span className="block mt-1 text-warning-foreground font-medium">
              Cambio de categoría probable
            </span>
          )}
        </div>
      </Card>

      <Card className="p-7">
        <div className="flex items-center gap-2 mb-1">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Cuota del mes
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-xl font-semibold tabular-nums">
            {formatCurrency(
              cliente.tipoActividad === 'servicios'
                ? categoriaActual.cuotaServicios
                : categoriaActual.cuotaComercio,
            )}
          </div>
        </div>
        <div className="mt-2">
          {cliente.estadoCuotaMesActual === 'al-dia' ? (
            <Badge variant="success">Al día</Badge>
          ) : (
            <Badge variant="danger">
              <AlertCircle className="h-3 w-3" /> Con deuda
            </Badge>
          )}
        </div>
      </Card>
    </div>
  );
}
