/**
 * Estado de cierre de cada movimiento conciliado. Fuente única de verdad para el reporte de la
 * conciliación: la ficha del cliente clasifica cada acreditación en exactamente uno de estos
 * estados y arma con eso el resumen (leídos / conciliados / a confirmar / por facturar / pendientes
 * / descartados) y los filtros. Se deriva de los datos que ya trae cada movimiento, sin pedir nada
 * extra al backend.
 */
import type { MovimientoBancario } from '@/types';

export type EstadoConciliacion =
  | 'conciliado' // cruzado con una factura por importe y CUIT (match confiable)
  | 'a-confirmar' // cruzado por tolerancia: requiere que el contador lo confirme
  | 'por-facturar' // el contador lo marcó como venta pero todavía no tiene factura
  | 'pendiente' // sin cruzar y sin decidir: pendiente de respaldo fiscal
  | 'descartado'; // el contador decidió que no corresponde facturar

/** Estado único de un movimiento (cada acreditación cae en exactamente uno). */
export function estadoConciliacion(m: MovimientoBancario): EstadoConciliacion {
  if (m.comprobanteMatcheadoId) {
    return m.matchConfianza === 'sugerido' ? 'a-confirmar' : 'conciliado';
  }
  if (m.marcadoComo === 'no-es-venta') return 'descartado';
  if (m.marcadoComo === 'ingreso-actividad') return 'por-facturar';
  return 'pendiente';
}

type Tono = 'success' | 'warning' | 'danger' | 'muted' | 'default';

export interface MetaEstado {
  /** Etiqueta corta para el badge de la fila y el filtro. */
  label: string;
  /** Subtítulo del KPI: qué significa el estado, en términos del contador. */
  resumen: string;
  tono: Tono;
}

export const ESTADO_META: Record<EstadoConciliacion, MetaEstado> = {
  conciliado: { label: 'Conciliados', resumen: 'Cruzados con una factura', tono: 'success' },
  'a-confirmar': { label: 'A confirmar', resumen: 'Cruce a revisar', tono: 'warning' },
  'por-facturar': { label: 'Por facturar', resumen: 'Marcados como venta', tono: 'default' },
  pendiente: { label: 'Pendientes', resumen: 'Sin respaldo, sin decidir', tono: 'danger' },
  descartado: { label: 'Descartados', resumen: 'No corresponde facturar', tono: 'muted' },
};

/** Orden en que se muestran los estados (de "resuelto" a "requiere acción" y termina en descartado). */
export const ORDEN_ESTADOS: EstadoConciliacion[] = [
  'conciliado',
  'a-confirmar',
  'por-facturar',
  'pendiente',
  'descartado',
];

export interface ResumenConciliacion {
  leidos: number;
  totalAcreditado: number;
  /** Por estado: cantidad de movimientos y monto sumado. */
  porEstado: Record<EstadoConciliacion, { cantidad: number; monto: number }>;
}

/** Arma el resumen de cierre a partir de la lista de movimientos del cliente. */
export function resumirConciliacion(movimientos: MovimientoBancario[]): ResumenConciliacion {
  const porEstado = Object.fromEntries(
    ORDEN_ESTADOS.map(e => [e, { cantidad: 0, monto: 0 }]),
  ) as ResumenConciliacion['porEstado'];

  let totalAcreditado = 0;
  for (const m of movimientos) {
    totalAcreditado += m.monto;
    const e = estadoConciliacion(m);
    porEstado[e].cantidad += 1;
    porEstado[e].monto += m.monto;
  }

  return { leidos: movimientos.length, totalAcreditado, porEstado };
}
