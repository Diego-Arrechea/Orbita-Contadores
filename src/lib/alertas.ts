/**
 * Generación de alertas de la cartera. Combina los cálculos de monotributo (monotributo.ts) con
 * los umbrales configurables (Configuracion) y produce alertas concretas + el color del semáforo.
 * Es pura: no hace fetch ni toca el DOM. El envío (WhatsApp/email) se monta encima en otra capa.
 */
import type { Cliente, Configuracion, EstadoAlerta } from '@/types';
import type { CalculoCliente } from '@/lib/monotributo';
import { esMonotributista } from '@/lib/regimen';
import { formatCurrency, formatDate, formatPercent } from '@/lib/utils';

export type Severidad = 'urgente' | 'aviso' | 'datos' | 'ok';

export type TipoAlerta =
  | 'tope'
  | 'recategorizacion'
  | 'ventana'
  | 'exclusion'
  | 'cuota'
  | 'meses_adeudados'
  | 'sync';

export interface Alerta {
  id: string;
  clienteId: string;
  clienteNombre: string;
  severidad: Severidad;
  tipo: TipoAlerta;
  titulo: string;
  detalle: string;
}

const PRIORIDAD: Record<Severidad, number> = { urgente: 0, aviso: 1, datos: 2, ok: 3 };

/** Genera las alertas concretas de un cliente a partir de sus cálculos y los umbrales. */
export function derivarAlertas(
  cliente: Cliente,
  calc: CalculoCliente,
  config: Configuracion,
): Alerta[] {
  const alertas: Alerta[] = [];
  const add = (severidad: Severidad, tipo: TipoAlerta, titulo: string, detalle: string) =>
    alertas.push({
      id: `${cliente.id}-${tipo}`,
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
      severidad,
      tipo,
      titulo,
      detalle,
    });

  // Sincronización con ARCA fallida (vale para cualquier régimen).
  if (cliente.resultadoUltimaExtraccion === 'fallida') {
    add(
      'datos',
      'sync',
      'La sincronización con ARCA falló',
      cliente.motivoFalloUltimaExtraccion ?? 'No se pudieron traer los últimos datos.',
    );
  }

  // Los no monotributistas (RI / régimen general / exento) no tienen alertas de monotributo
  // (tope, categoría, cuota).
  if (!esMonotributista(cliente)) return alertas;

  // Tope de facturación.
  const pct = calc.porcentajeTopeActual;
  if (pct >= 1) {
    add(
      'urgente',
      'tope',
      'Superó el tope de su categoría',
      `Facturó el ${formatPercent(pct, 0)} del tope anual. Riesgo de exclusión.`,
    );
  } else if (pct >= config.alertas.tope.avisarPct) {
    add('aviso', 'tope', 'Cerca del tope', `Lleva el ${formatPercent(pct, 0)} del tope de su categoría.`);
  } else if (config.alertas.tope.proyeccionCruce && calc.fechaProyectadaCruceTope) {
    add(
      'aviso',
      'tope',
      'Proyección de cruce de tope',
      `Al ritmo actual cruzaría el tope el ${formatDate(calc.fechaProyectadaCruceTope, 'long')}.`,
    );
  }

  // Recategorización sugerida (la facturación encaja en otra categoría).
  if (cliente.categoria && calc.categoriaCorresponde.codigo !== cliente.categoria) {
    add(
      'aviso',
      'recategorizacion',
      'Debería recategorizarse',
      `Por su facturación le corresponde la Cat. ${calc.categoriaCorresponde.codigo}.`,
    );
  }

  // Ventana de recategorización próxima.
  const dias = calc.diasParaProximaVentana;
  if (Number.isFinite(dias) && calc.proximaVentana) {
    if (dias <= config.alertas.ventana.urgenteDias) {
      add(
        'urgente',
        'ventana',
        'Cierra la ventana de recategorización',
        `Faltan ${dias} días (vence el ${formatDate(calc.proximaVentana.fechaLimite, 'long')}).`,
      );
    } else if (dias <= config.alertas.ventana.avisoDias) {
      add('aviso', 'ventana', 'Se viene la recategorización', `Faltan ${dias} días para la próxima ventana.`);
    }
  }

  // Riesgo de exclusión por gastos (compras vs tope cat. K, art. 20 inc. j).
  if (calc.ratioSuperadoLegal) {
    add(
      'urgente',
      'exclusion',
      'Riesgo de exclusión por gastos',
      `Sus compras son el ${formatPercent(calc.ratioGastosTopeCatK, 0)} del tope K (supera el ${formatPercent(calc.ratioUmbralLegal, 0)} permitido).`,
    );
  } else if (calc.ratioGastosTopeCatK >= config.alertas.exclusion.avisarRatioPct) {
    add('aviso', 'exclusion', 'Gastos altos', `Sus compras son el ${formatPercent(calc.ratioGastosTopeCatK, 0)} del tope K.`);
  }

  // Cuota del mes impaga. Siempre AVISO (amarillo): deber la cuota del mes —o un monto— es un
  // heads-up, no una urgencia. El ROJO (acción urgente) por deuda lo da SÓLO cruzar los X meses
  // seguidos (alerta meses_adeudados, abajo), no el monto adeudado.
  if (cliente.estadoCuotaMesActual === 'con-deuda') {
    const deuda = cliente.cuotaDeuda ?? 0;
    const cuotaMes = cliente.proxVencImporte ?? 0;
    const esChica = cuotaMes > 0 && deuda > 0 && deuda < cuotaMes * config.alertas.cuota.urgenteDesdePct;
    if (esChica) {
      add(
        'aviso',
        'cuota',
        'Saldo pendiente en la cuota',
        `Adeuda ${formatCurrency(deuda)} (${formatPercent(deuda / cuotaMes, 0)} de la cuota del mes).`,
      );
    } else {
      add(
        'aviso',
        'cuota',
        'Cuota del mes impaga',
        deuda ? `Adeuda ${formatCurrency(deuda)}.` : 'Tiene la cuota del mes con deuda.',
      );
    }
  }

  // Deuda de varios meses seguidos (de la Consulta de Saldos de la CCMA). Distinta de la cuota del
  // mes: mide la RACHA de meses impagos. Avisa al alcanzar el umbral configurado (8 por defecto).
  const meses = cliente.mesesAdeudados ?? 0;
  if (meses >= config.alertas.meses_adeudados.umbralMeses) {
    add(
      'urgente',
      'meses_adeudados',
      `Adeuda ${meses} meses seguidos`,
      `Acumula ${meses} meses seguidos de deuda en la cuota del monotributo.`,
    );
  }

  return alertas;
}

/** Color del semáforo del cliente, derivado de sus alertas (urgente > sin datos > aviso > ok). */
export function estadoDesdeAlertas(alertas: Alerta[], cliente: Cliente): EstadoAlerta {
  if (alertas.some(a => a.severidad === 'urgente')) return 'rojo';
  // 'sin datos' = nunca pudimos traerle nada. Usamos `tieneComprobantes` (flag del backend) porque
  // en el dashboard `comprobantes` viene vacío a propósito (no se baja el detalle por cliente);
  // en la ficha, donde sí viene completo, el flag refleja lo mismo (length > 0).
  const tieneComps = cliente.tieneComprobantes ?? (cliente.comprobantes?.length ?? 0) > 0;
  const sinDatos = cliente.resultadoUltimaExtraccion === 'fallida' || !tieneComps;
  if (sinDatos) return 'gris';
  if (alertas.some(a => a.severidad === 'aviso')) return 'amarillo';
  return 'verde';
}

/** Ordena alertas con las urgentes primero. */
export function ordenarPorSeveridad(alertas: Alerta[]): Alerta[] {
  return [...alertas].sort((a, b) => PRIORIDAD[a.severidad] - PRIORIDAD[b.severidad]);
}
