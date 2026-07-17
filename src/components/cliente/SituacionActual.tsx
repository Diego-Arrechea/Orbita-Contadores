import { useState } from 'react';
import { TrendingUp, AlertCircle, CalendarClock, CreditCard, ArrowRight, Building2, Wheat, Clock, PencilLine, Briefcase, CalendarRange } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProgresoTope } from '@/components/shared/ProgresoTope';
import { cn, formatCurrency, formatDate, formatPercent } from '@/lib/utils';
import { getCategoria } from '@/data/categorias';
import { esMonotributista, etiquetaRegimen, regimenPendiente } from '@/lib/regimen';
import { esAdminReal } from '@/lib/cuenta';
import { useConfig } from '@/context/ConfigContext';
import { VerDetalle } from '@/components/cliente/VerDetalle';
import { detallesSituacion } from '@/lib/trazabilidad';
import { facturadoEnVentana, cierreSemestreRecat, HOY, type CalculoCliente } from '@/lib/monotributo';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
  calc: CalculoCliente;
  /** Salta a la solapa con el detalle de comprobantes que componen la facturación 12m. */
  onVerComprobantes?: () => void;
}

export function SituacionActual({ cliente, calc, onVerComprobantes }: Props) {
  const { config, inflacionMercado } = useConfig();
  // Toggle del visor del tope: "Hoy" vs "Ajustado por inflación" (declarado antes de cualquier
  // return para no romper el orden de hooks).
  const [verInflacion, setVerInflacion] = useState(false);
  // Período para EVALUAR la recategorización: 'recat' (los 12 meses que cierran en el último semestre),
  // 'rolling' (últimos 12 a hoy) o 'AAAA-M' (un mes de cierre elegido). Ver el evaluador al pie del card.
  const [periodoSel, setPeriodoSel] = useState('recat');
  // Todavía no tenemos el dato del régimen (el alta no llegó a traerlo). NO afirmamos que no es
  // monotributista: mostramos un cartel de "en proceso" y, si la clave está mal cargada, cómo destrabarlo.
  if (regimenPendiente(cliente)) {
    return (
      <Card className="p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">Datos en proceso</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              {cliente.claveInvalida
                ? 'Todavía no pudimos traer la situación de este cliente porque la clave fiscal cargada no es correcta. Actualizá la clave desde el botón de la ficha y la información se completa sola.'
                : 'Estamos preparando la información de este cliente. En breve vas a ver acá su situación de monotributo.'}
            </p>
          </div>
        </div>
      </Card>
    );
  }
  if (!esMonotributista(cliente)) {
    const esRI = cliente.regimen === 'responsable_inscripto';
    return (
      <Card className="p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold">{etiquetaRegimen(cliente.regimen)}</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              {esRI
                ? 'Este cliente no es monotributista, así que el seguimiento de monotributo (categoría, topes, recategorización y cuota) no aplica. Podés ver sus comprobantes e histórico en las otras solapas.'
                : 'Este cliente no figura como monotributista, así que el seguimiento de monotributo (categoría, topes, recategorización y cuota) no aplica. Podés ver sus comprobantes e histórico en las otras solapas.'}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const categoriaActual = getCategoria(cliente.categoria);
  const ratioPct = calc.ratioGastosTopeCatK;
  const ratioUmbralStr = formatPercent(calc.ratioUmbralLegal);
  // Respaldo de gastos por relación de dependencia: cuánto del total comprado a "consumidor final"
  // (compras 12m) queda cubierto por el haber percibido informado, si tenemos la remuneración.
  const rem = cliente.remuneracion;
  const respaldo =
    rem && rem.totalBruto > 0
      ? {
          empleador: rem.empleadores[0],
          total: rem.totalBruto,
          restante: Math.max(0, calc.comprasUltimos12 - rem.totalBruto),
          cubierto:
            calc.comprasUltimos12 > 0 ? Math.min(1, rem.totalBruto / calc.comprasUltimos12) : 1,
        }
      : null;

  // Facturación últimos 12 meses para el gauge: si tenemos la cifra OFICIAL de ARCA (facturómetro del
  // padrón) la usamos como autoritativa; si no, caemos al cálculo propio por comprobantes. Lo mismo
  // con el tope (ARCA da el de su categoría; coincide con la tabla ya corregida). El cálculo propio
  // sigue moviendo proyecciones/recategorización; ARCA es la foto oficial de "dónde estás hoy".
  const facturacionComputada =
    calc.mesesConActividad < 12 ? calc.facturacionUltimos12Anualizada : calc.facturacionUltimos12;
  // El facturómetro oficial sólo se considera válido si trae un monto > 0: a veces el panel de ARCA
  // responde 0 por una carga incompleta del AJAX (con la fecha de corte ya puesta) → ese 0 NO es real
  // (lo delata tener comprobantes por encima). En ese caso caemos al cálculo propio (sin rotularlo
  // "Según ARCA"), en vez de mostrar $0 sobre un cliente que sí facturó.
  const tieneOficial = cliente.facturacion12mOficial != null && cliente.facturacion12mOficial > 0;
  const topeOficialValido =
    cliente.topeCategoriaOficial != null && cliente.topeCategoriaOficial > 0;
  // La cifra oficial de ARCA no incluye lo cargado a mano: se lo sumamos para que cuente contra el
  // tope. El cálculo propio (sin oficial) ya lo trae por los comprobantes.
  const facturacionMostrada = tieneOficial
    ? cliente.facturacion12mOficial! + calc.facturacionManual12m
    : facturacionComputada;
  const topeMostrado = topeOficialValido ? cliente.topeCategoriaOficial! : categoriaActual.topeAnual;
  const porcentajeMostrado = topeMostrado > 0 ? facturacionMostrada / topeMostrado : 0;

  // Visor del tope: "Hoy" (facturado contra el tope vigente) vs "Ajustado por inflación". En el
  // segundo modo el FACTURADO y la CATEGORÍA no cambian; sólo sube el TOPE de tu misma categoría,
  // actualizado por la inflación del semestre → baja el % consumido (te da aire). El cartel de "te
  // evita subir" se calcula aparte en el motor y no toca la categoría/tope que se muestran acá.
  const facturacionVista = facturacionMostrada;
  const topeVista = verInflacion ? topeMostrado * calc.factorTopesInflacion : topeMostrado;
  const porcentajeVista = topeVista > 0 ? facturacionVista / topeVista : porcentajeMostrado;
  const categoriaVista = cliente.categoria;

  // Trazabilidad: explicación de cada valor calculado de esta vista (ver botones ⓘ).
  const d = detallesSituacion(cliente, calc);

  // Evaluador de recategorización (#3): facturado 12m del PERÍODO elegido + la categoría que le
  // correspondería. El facturómetro OFICIAL de ARCA es sólo el rolling a hoy, así que para el período
  // de recat (u otro) se calcula por comprobantes (historial, que ya incluye la carga manual).
  const cierreRecat = cierreSemestreRecat();
  const hastaEval =
    periodoSel === 'rolling'
      ? HOY
      : periodoSel === 'recat'
        ? cierreRecat
        : new Date(Number(periodoSel.split('-')[0]), Number(periodoSel.split('-')[1]), 1);
  const evalVentana = facturadoEnVentana(cliente, hastaEval);
  const evalDebe = evalVentana.categoriaCorresponde.codigo !== cliente.categoria;
  const mesCorto = (dd: Date) => dd.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
  const rangoEval = `${mesCorto(evalVentana.desde)} – ${mesCorto(evalVentana.hasta)}`;
  // Opciones de "mes de cierre" custom: los últimos 12 meses (dentro de los 26 de historial que trae
  // la ficha, así la ventana de 12 queda siempre cubierta).
  const mesesEval = Array.from({ length: 12 }, (_, i) => {
    const dd = new Date(HOY.getFullYear(), HOY.getMonth() - i, 1);
    return { value: `${dd.getFullYear()}-${dd.getMonth()}`, label: `Cierre en ${mesCorto(dd)}` };
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card className="p-5 sm:p-7 col-span-full lg:col-span-2">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 inline-flex items-center gap-1.5">
              Facturación últimos 12 meses
              <VerDetalle detalle={d.facturacion12m} />
              {!tieneOficial && calc.mesesConActividad < 12 && (
                <span className="ml-1 text-warning-foreground normal-case tracking-normal">
                  (anualizada con {calc.mesesConActividad}m de actividad)
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <div className="text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight">
                {formatCurrency(facturacionVista)}
              </div>
              <div className="text-sm text-muted-foreground">
                / {formatCurrency(topeVista)}
              </div>
            </div>
          </div>
          <Badge variant="outline" className="font-semibold">
            Cat. {categoriaVista}
          </Badge>
        </div>

        <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setVerInflacion(false)}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              !verInflacion
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => setVerInflacion(true)}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              verInflacion
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Ajustado por inflación
          </button>
        </div>

        <ProgresoTope porcentaje={porcentajeVista} showLabel={false} />

        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            {formatPercent(porcentajeVista, 1)} consumido
            <VerDetalle detalle={verInflacion ? d.proyeccionInflacion : d.porcentajeTope} />
          </span>
          {verInflacion ? (
            calc.inflacionEvitaSubirCategoria ? (
              <span className="inline-flex items-center gap-1 font-medium text-success">
                La inflación te evita subir a Cat. {calc.categoriaCorresponde.codigo}
              </span>
            ) : (
              <span className="text-muted-foreground">
                La inflación no cambia tu categoría
              </span>
            )
          ) : (
            calc.fechaProyectadaCruceTope && (
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                Proyección cruce: {formatDate(calc.fechaProyectadaCruceTope, 'long')}
                <VerDetalle detalle={d.proyeccionCruce} align="end" />
              </span>
            )
          )}
        </div>

        {verInflacion && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Mismo facturado; tope actualizado con {formatPercent(calc.inflacionMensualUsada, 1)} mensual
            de inflación
            {config.inflacionAuto && inflacionMercado
              ? ', según las expectativas de mercado'
              : ' (valor definido por vos)'}
            .
          </div>
        )}

        {!verInflacion && onVerComprobantes && (
          <button
            type="button"
            onClick={onVerComprobantes}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Ver los comprobantes que lo componen
            <ArrowRight className="h-3 w-3" />
          </button>
        )}

        {!verInflacion && cliente.facturaAgro && calc.facturacionAgro12m > 0 && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Wheat className="h-3 w-3 text-primary shrink-0" />
            Incluye {formatCurrency(calc.facturacionAgro12m)} de facturación agropecuaria.
          </div>
        )}

        {!verInflacion && calc.facturacionManual12m !== 0 && (
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <PencilLine className="h-3 w-3 text-primary shrink-0" />
            Incluye {formatCurrency(calc.facturacionManual12m)} de comprobantes cargados a mano.
          </div>
        )}

        {!verInflacion && tieneOficial && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Según ARCA
            {cliente.facturometroActualizado ? ` · al ${cliente.facturometroActualizado}` : ''}
            {/* "Órbita estima ..." es un diagnóstico interno (sirve para chequear que los
                comprobantes se trajeron bien comparando contra el dato oficial): sólo el superadmin
                lo ve, aunque esté impersonando a un contador. */}
            {esAdminReal() && Math.abs(calc.facturacionUltimos12 - facturacionMostrada) > 1 && (
              <span> · Órbita estima {formatCurrency(calc.facturacionUltimos12)} al día de hoy</span>
            )}
          </div>
        )}

        {/* Evaluador de recategorización (#3): elegí el período (default: el semestre de recat) y ves el
            facturado de ese período y la categoría que corresponde. Reemplaza el aviso fijo por uno
            editable, para mirar exactamente el período que evalúa ARCA (ej. jul-2025 a jun-2026). El
            facturómetro oficial es sólo rolling a hoy → acá se calcula por comprobantes. */}
        {!verInflacion && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5" />
                Evaluar recategorización
              </div>
              <Select value={periodoSel} onValueChange={setPeriodoSel}>
                <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recat">Período de recategorización</SelectItem>
                  <SelectItem value="rolling">Últimos 12 meses</SelectItem>
                  {mesesEval.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 text-sm',
                evalDebe
                  ? 'bg-warning/15 border border-warning/30'
                  : 'bg-muted/40 border border-border',
              )}
            >
              <span className="text-xs text-muted-foreground tabular-nums">{rangoEval}</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(evalVentana.facturado)}
              </span>
              <span className="inline-flex items-center gap-1.5 ml-auto">
                {evalDebe && <TrendingUp className="h-4 w-4 text-warning-foreground" />}
                corresponde
                <Badge variant={evalDebe ? 'warning' : 'muted'} className="font-semibold">
                  Cat. {evalVentana.categoriaCorresponde.codigo}
                </Badge>
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Según los comprobantes del período
              {evalDebe
                ? ` · hoy figura en Cat. ${cliente.categoria}`
                : ' · coincide con su categoría actual'}
              .
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-7">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 inline-flex items-center gap-1.5">
          Próxima ventana
          <VerDetalle detalle={d.proximaVentana} />
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

      <Card className="p-5 sm:p-7">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            Ratio compras / tope K
            <VerDetalle detalle={d.ratioGastos} />
          </div>
          {calc.ratioSuperadoLegal && (
            <Badge variant="danger" className="text-[10px]">
              superado
            </Badge>
          )}
        </div>
        <div className="text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight">
          {formatPercent(ratioPct, 1)}
        </div>
        <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Umbral legal {cliente.tipoActividad}: <span className="font-medium">{ratioUmbralStr}</span>
          <br />
          Compras / ventas propias: {formatPercent(calc.ratioGastosVentas, 0)}
        </div>
        {cliente.relacionDependencia && (
          <div className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {respaldo ? (
              <>
                Trabaja en relación de dependencia
                {respaldo.empleador ? ` en ${respaldo.empleador}` : ''}. El haber percibido de los
                últimos 12 meses ({formatCurrency(respaldo.total)}){' '}
                {respaldo.restante > 0 ? (
                  <>
                    respalda cerca del {formatPercent(respaldo.cubierto, 0)} de estas compras; quedan{' '}
                    {formatCurrency(respaldo.restante)} sin justificar por el sueldo.
                  </>
                ) : (
                  <>
                    cubre la totalidad de estas compras, aunque figuren a consumidor final y no estén
                    vinculadas a la actividad.
                  </>
                )}
              </>
            ) : (
              <>
                Tiene relación de dependencia: parte de estas compras pueden estar justificadas por el
                haber percibido, aunque figuren a consumidor final y no estén vinculadas a la actividad.
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-7">
        <div className="flex items-center gap-2 mb-1">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            Cuota del mes
            <VerDetalle detalle={d.cuota} />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-xl font-semibold tabular-nums">
            {formatCurrency(
              cliente.proxVencImporte ??
                (cliente.tipoActividad === 'servicios'
                  ? categoriaActual.cuotaServicios
                  : categoriaActual.cuotaComercio),
            )}
          </div>
          {cliente.proxVencFecha && (
            <span className="text-xs text-muted-foreground">vence {cliente.proxVencFecha}</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {cliente.estadoCuotaMesActual === 'al-dia' ? (
            <Badge variant="success">Al día</Badge>
          ) : (
            <Badge variant="danger">
              <AlertCircle className="h-3 w-3" /> Con deuda
              {cliente.cuotaDeuda ? ` · ${formatCurrency(cliente.cuotaDeuda)}` : ''}
            </Badge>
          )}
          {/* Racha de meses seguidos que adeuda (de la Consulta de Saldos). Sólo cuando efectivamente
              es deudor hoy (>= 1); el número acumula mientras no se ponga al día. */}
          {cliente.estadoCuotaMesActual === 'con-deuda' && !!cliente.mesesAdeudados && cliente.mesesAdeudados >= 1 && (
            <Badge variant="warning">
              Adeuda {cliente.mesesAdeudados} {cliente.mesesAdeudados === 1 ? 'mes' : 'meses'} seguido{cliente.mesesAdeudados === 1 ? '' : 's'}
            </Badge>
          )}
          {cliente.debitoAutomatico && <Badge variant="muted">Débito automático</Badge>}
          {!!cliente.cuotaSaldoFavor && cliente.cuotaSaldoFavor > 0 && (
            <span className="text-xs text-success">
              {formatCurrency(cliente.cuotaSaldoFavor)} a favor
            </span>
          )}
        </div>
      </Card>

      {/* Actividades económicas declaradas en el padrón (código + descripción + período). La primera
          es la principal. Sólo se muestra si ya se trajeron del padrón. */}
      {cliente.actividades && cliente.actividades.length > 0 && (
        <Card className="p-5 sm:p-7 col-span-full">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 inline-flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            Actividades declaradas
          </div>
          <ul className="space-y-2.5">
            {cliente.actividades.map((a, i) => (
              <li key={`${a.codigo ?? ''}-${i}`} className="flex items-start gap-3 text-sm">
                {a.codigo && (
                  <span className="shrink-0 tabular-nums rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {a.codigo}
                  </span>
                )}
                <div className="min-w-0 leading-relaxed">
                  <span className="text-foreground">{a.descripcion ?? 'Actividad sin descripción'}</span>
                  {i === 0 && (
                    <Badge variant="muted" className="ml-2 align-middle text-[10px]">
                      Principal
                    </Badge>
                  )}
                  {a.periodo && (
                    <span className="ml-2 text-xs text-muted-foreground">desde {a.periodo}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
