/**
 * Datos del reporte del cliente (la pantalla imprimible y el mail que se le envía). Una sola fuente
 * para los dos: así lo que el contador ve en pantalla es exactamente lo que le llega al cliente.
 */
import { calcularCliente, periodoProximaRecat, ventana12Meses, HOY, type CalculoCliente } from '@/lib/monotributo';
import { esMonotributista } from '@/lib/regimen';
import { getCategoria } from '@/data/categorias';
import { derivarAlertas, ordenarPorSeveridad, type Alerta } from '@/lib/alertas';
import { accionesSugeridas, esPendienteRespaldo } from '@/lib/reporteCliente';
import { formatCurrency, formatPercent } from '@/lib/utils';
import type { Categoria, Cliente, Configuracion, ConfigReporte, HistorialMes, MovimientoBancario } from '@/types';

export type ClaveMetrica = keyof ConfigReporte['metricas'];

export interface MetricaReporte {
  key: ClaveMetrica;
  label: string;
  /** null = la métrica no aplica a este cliente (no se ofrece ni se muestra). */
  valor: string | null;
}

/** Situación de monotributo medida sobre UN período: el de la próxima recategorización o los meses
 *  que eligió el contador. Facturado, % del tope y cuánto puede facturar por mes salen todos de acá,
 *  así las cards no mezclan períodos (antes: monto de 12 meses corridos al lado de un % del
 *  facturómetro, que mide desde el inicio del período de recategorización). */
export interface SituacionPeriodo {
  modo: ConfigReporte['periodoSituacion'];
  /** Para el título de la card: "desde ene 2026", "ene 2026 – sep 2026", "9 meses elegidos". */
  etiqueta: string;
  facturado: number;
  tope: number;
  porcentaje: number;
  /** Meses que quedan para completar los 12 (en el de recategorización, incluye el mes en curso). */
  mesesRestantes: number;
  /** Margen contra el tope repartido en los meses restantes; null si no quedan meses. */
  porMes: number | null;
  /** Aclaración de una línea bajo las cards: qué período es y de dónde sale el facturado. */
  nota: string;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const idxMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  return y * 12 + (m - 1);
};
const idxFecha = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const mesCorto = (idx: number) => `${MESES_CORTOS[idx % 12]} ${Math.floor(idx / 12)}`;

/** 'dd/mm/aaaa' (fecha de corte del facturómetro) → índice de mes; null si no se puede leer. */
function idxCorte(corte?: string): number | null {
  const m = corte?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Number(m[3]) * 12 + Number(m[2]) - 1 : null;
}

/** Los dos períodos de 12 meses abiertos, para el selector del reporte: el que evalúa la próxima
 *  recategorización (ej. ene–dic 2026 → enero 2027) y el que arranca 6 meses después (jul 2026 –
 *  jun 2027 → julio 2027). Se corren solos cada semestre. El contador los pidió por mes de arranque
 *  ("desde 01/2026", "desde 07/2026"): "desde la última recategorización" se leía como julio. */
export function ventanasAbiertas(
  calc: CalculoCliente,
  hoy: Date = HOY,
): { modo: 'recategorizacion' | 'siguiente'; desdeIdx: number; etiqueta: string }[] {
  const base = idxFecha(periodoProximaRecat(calc.proximaVentana, hoy).desde);
  return ([['recategorizacion', base], ['siguiente', base + 6]] as const).map(([modo, desdeIdx]) => {
    const recat = desdeIdx + 12;
    return {
      modo,
      desdeIdx,
      etiqueta: `Desde ${mesCorto(desdeIdx)} (recategorización de ${MESES_LARGOS[recat % 12]} ${Math.floor(recat / 12)})`,
    };
  });
}

export function situacionPeriodo(
  cliente: Cliente,
  calc: CalculoCliente,
  modo: ConfigReporte['periodoSituacion'],
  mesesElegidos: string[] = [],
  hoy: Date = HOY,
): SituacionPeriodo {
  const tope = calc.topeReferencia;
  const netoMes = (m: HistorialMes) => m.emitidasNetas + m.ingresosNoFacturados;
  const elegidos = new Set(mesesElegidos);
  const delHistorial = cliente.historialMensual.filter(m => elegidos.has(m.mes));

  if (modo === 'meses' && delHistorial.length > 0) {
    const idxs = delHistorial.map(m => idxMes(m.mes)).sort((a, b) => a - b);
    const n = idxs.length;
    const contiguos = idxs[n - 1] - idxs[0] + 1 === n;
    const etiqueta =
      n === 1 ? mesCorto(idxs[0]) : contiguos ? `${mesCorto(idxs[0])} – ${mesCorto(idxs[n - 1])}` : `${n} meses elegidos`;
    const facturado = delHistorial.reduce((acc, m) => acc + netoMes(m), 0);
    const restantes = Math.max(0, 12 - n);
    return {
      modo,
      etiqueta,
      facturado,
      tope,
      porcentaje: tope > 0 ? facturado / tope : 0,
      mesesRestantes: restantes,
      porMes: restantes > 0 ? Math.max(0, tope - facturado) / restantes : null,
      nota: `${n} ${n === 1 ? 'mes elegido' : 'meses elegidos'}${
        contiguos || n === 1 ? '' : ` entre ${mesCorto(idxs[0])} y ${mesCorto(idxs[n - 1])}`
      }, según los comprobantes emitidos.`,
    };
  }

  // Uno de los dos períodos de 12 meses abiertos: el de la próxima recategorización o el que arranca
  // 6 meses después (el de la recategorización siguiente). El facturómetro mide sólo el primero: si
  // su fecha de corte cae dentro, manda (ya trae lo que los comprobantes no muestran, p. ej. el agro);
  // si es de antes (de un período anterior), no está, o es el período siguiente, se suman los
  // comprobantes del período.
  const ventana = ventanasAbiertas(calc, hoy).find(v => v.modo === modo) ?? ventanasAbiertas(calc, hoy)[0];
  const desdeIdx = ventana.desdeIdx;
  const hastaIdx = desdeIdx + 11;
  const hoyIdx = idxFecha(hoy);
  const corte = idxCorte(cliente.facturometroActualizado);
  const oficialDelPeriodo =
    ventana.modo === 'recategorizacion' &&
    (cliente.facturacion12mOficial ?? 0) > 0 &&
    corte != null &&
    corte >= desdeIdx &&
    corte <= hastaIdx;
  const facturado = oficialDelPeriodo
    ? calc.nivelTope
    : cliente.historialMensual
        .filter(m => idxMes(m.mes) >= desdeIdx && idxMes(m.mes) <= hastaIdx)
        .reduce((acc, m) => acc + netoMes(m), 0);
  const restantes = Math.max(0, Math.min(12, hastaIdx - hoyIdx + 1));
  const recat = hastaIdx + 1; // mes en que se recategoriza (el siguiente al cierre del período)
  return {
    modo: ventana.modo,
    etiqueta: `desde ${mesCorto(desdeIdx)}`,
    facturado,
    tope,
    porcentaje: tope > 0 ? facturado / tope : 0,
    mesesRestantes: restantes,
    porMes: restantes > 0 ? Math.max(0, tope - facturado) / restantes : null,
    nota: `Período de la recategorización de ${MESES_LARGOS[recat % 12]} ${Math.floor(recat / 12)}: ${mesCorto(
      desdeIdx,
    )} a ${mesCorto(hastaIdx)}. ${
      oficialDelPeriodo
        ? `Facturado según el facturómetro oficial al ${cliente.facturometroActualizado}.`
        : 'Facturado según los comprobantes emitidos.'
    }`,
  };
}

export interface DatosReporte {
  calc: CalculoCliente;
  situacion: SituacionPeriodo;
  noMono: boolean;
  cat: Categoria;
  debeRecategorizar: boolean;
  historial: HistorialMes[];
  alertas: Alerta[];
  pendientes: MovimientoBancario[];
  acciones: string[];
  metricas: MetricaReporte[];
  /** Las que aplican a este cliente (tienen valor): las que se pueden mostrar/ocultar. */
  metricasDisponibles: MetricaReporte[];
}

/** Opciones efectivas del reporte de un cliente: las suyas (si el contador las personalizó) sobre
 *  las generales del estudio. Tolera opciones guardadas parciales o de versiones viejas. */
export function opcionesReporte(general: ConfigReporte, propias?: Partial<ConfigReporte> | null): ConfigReporte {
  if (!propias) return general;
  return {
    secciones: { ...general.secciones, ...(propias.secciones ?? {}) },
    metricas: { ...general.metricas, ...(propias.metricas ?? {}) },
    mesesHistorial: propias.mesesHistorial ?? general.mesesHistorial,
    periodoSituacion: propias.periodoSituacion ?? general.periodoSituacion,
    mesesSituacion: propias.mesesSituacion ?? general.mesesSituacion,
  };
}

export function armarDatosReporte(
  cliente: Cliente,
  config: Configuracion,
  inflacion: number,
  movimientos: MovimientoBancario[],
  rep: ConfigReporte,
): DatosReporte {
  const calc = calcularCliente(cliente, config.ventanas, inflacion);
  const noMono = !esMonotributista(cliente);
  const cat = getCategoria(cliente.categoria);
  const debeRecategorizar = !noMono && calc.categoriaCorresponde.codigo !== cliente.categoria;
  // Historial recortado a los últimos N meses que el contador eligió (de los hasta 12 disponibles).
  const historial = ventana12Meses(cliente.historialMensual).slice(-rep.mesesHistorial);
  const alertas = ordenarPorSeveridad(derivarAlertas(cliente, calc, config));
  const pendientes = movimientos.filter(esPendienteRespaldo);
  const acciones = accionesSugeridas(cliente, calc, alertas, pendientes.length);

  // Cards de la sección "Situación de monotributo", data-driven para poder sacar/poner cada una.
  const meses = cliente.mesesAdeudados ?? 0;
  const situacion = situacionPeriodo(cliente, calc, rep.periodoSituacion, rep.mesesSituacion);
  const r = situacion.mesesRestantes;
  const metricas: MetricaReporte[] = noMono
    ? []
    : [
        { key: 'facturacion12m', label: `Facturado ${situacion.etiqueta}`, valor: formatCurrency(situacion.facturado) },
        { key: 'topeCategoria', label: 'Tope de la categoría', valor: formatCurrency(situacion.tope) },
        { key: 'topeConsumido', label: 'Tope consumido', valor: formatPercent(situacion.porcentaje, 1) },
        {
          key: 'margenMensual',
          label: `Puede facturar por mes (${r} ${r === 1 ? 'mes restante' : 'meses restantes'})`,
          valor:
            situacion.porMes == null
              ? null
              : situacion.porMes > 0
                ? formatCurrency(situacion.porMes)
                : 'Ya alcanzó el tope',
        },
        {
          key: 'cuotaMes',
          label: 'Cuota del mes',
          valor: formatCurrency(
            cliente.proxVencImporte ??
              (cliente.tipoActividad === 'servicios' ? cat.cuotaServicios : cat.cuotaComercio),
          ),
        },
        { key: 'estadoCuota', label: 'Estado de la cuota', valor: cliente.estadoCuotaMesActual === 'con-deuda' ? 'Con deuda' : 'Al día' },
        { key: 'proximoVencimiento', label: 'Próximo vencimiento', valor: cliente.proxVencFecha ?? '—' },
        { key: 'deudaCuota', label: 'Deuda de cuota', valor: formatCurrency(cliente.cuotaDeuda ?? 0) },
        {
          key: 'mesesAdeudados',
          label: 'Meses adeudados',
          valor: meses >= 1 ? `${meses} ${meses === 1 ? 'mes' : 'meses'} seguido${meses === 1 ? '' : 's'}` : null,
        },
        {
          key: 'saldoFavor',
          label: 'Saldo a favor',
          valor: cliente.cuotaSaldoFavor && cliente.cuotaSaldoFavor > 0 ? formatCurrency(cliente.cuotaSaldoFavor) : null,
        },
      ];

  return {
    calc,
    situacion,
    noMono,
    cat,
    debeRecategorizar,
    historial,
    alertas,
    pendientes,
    acciones,
    metricas,
    metricasDisponibles: metricas.filter(m => m.valor !== null),
  };
}
