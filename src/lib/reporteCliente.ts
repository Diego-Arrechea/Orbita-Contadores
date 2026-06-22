/**
 * Lógica compartida del "papel de trabajo" del cliente (reporte exportable a PDF y Excel).
 * Mantiene una sola fuente de verdad para las acciones sugeridas y el conteo de movimientos
 * pendientes de respaldo, así el PDF y el Excel siempre coinciden.
 */
import type { Cliente } from '@/types';
import type { CalculoCliente } from '@/lib/monotributo';
import type { Alerta } from '@/lib/alertas';
import { esMonotributista } from '@/lib/regimen';
import { formatCurrency } from '@/lib/utils';

/** Un movimiento está "pendiente de respaldo" si no se cruzó con un comprobante ni lo clasificó el contador. */
export function esPendienteRespaldo(m: { comprobanteMatcheadoId?: string; marcadoComo?: string }): boolean {
  return !m.comprobanteMatcheadoId && !m.marcadoComo;
}

/** Acciones concretas y accionables sugeridas para el cliente (imperativas, en orden de urgencia). */
export function accionesSugeridas(
  cliente: Cliente,
  calc: CalculoCliente,
  alertas: Alerta[],
  movimientosPendientes: number,
): string[] {
  const acciones: string[] = [];
  const mono = esMonotributista(cliente);

  if (mono && calc.porcentajeTopeActual >= 1) {
    acciones.push('Superó el tope anual: evaluar recategorización o cambio de régimen con urgencia.');
  } else if (mono && cliente.categoria && calc.categoriaCorresponde.codigo !== cliente.categoria) {
    acciones.push(
      `Recategorizar a Cat. ${calc.categoriaCorresponde.codigo} (tope ${formatCurrency(calc.categoriaCorresponde.topeAnual)}).`,
    );
  }
  if (mono && cliente.estadoCuotaMesActual === 'con-deuda') {
    const deuda = cliente.cuotaDeuda ?? 0;
    acciones.push(
      deuda > 0
        ? `Regularizar la cuota del mes (adeuda ${formatCurrency(deuda)}).`
        : 'Regularizar la cuota del mes impaga.',
    );
  }
  if (mono && calc.ratioSuperadoLegal) {
    acciones.push('Revisar las compras: superan el umbral de gastos que habilita la exclusión.');
  }
  if (movimientosPendientes > 0) {
    acciones.push(
      `Revisar ${movimientosPendientes} ${movimientosPendientes === 1 ? 'movimiento pendiente' : 'movimientos pendientes'} de respaldo fiscal.`,
    );
  }
  if (
    mono &&
    Number.isFinite(calc.diasParaProximaVentana) &&
    calc.diasParaProximaVentana <= 30 &&
    calc.proximaVentana
  ) {
    acciones.push(
      `Se acerca la ventana de recategorización (faltan ${calc.diasParaProximaVentana} días).`,
    );
  }
  if (cliente.resultadoUltimaExtraccion === 'fallida') {
    acciones.push('Reintentar la actualización de datos del cliente.');
  }
  if (acciones.length === 0) {
    acciones.push('Sin acciones pendientes: el cliente está al día.');
  }
  return acciones;
}
