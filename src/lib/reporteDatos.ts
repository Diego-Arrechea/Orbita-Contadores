/**
 * Datos del reporte del cliente (la pantalla imprimible y el mail que se le envía). Una sola fuente
 * para los dos: así lo que el contador ve en pantalla es exactamente lo que le llega al cliente.
 */
import { calcularCliente, ventana12Meses, type CalculoCliente } from '@/lib/monotributo';
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

export interface DatosReporte {
  calc: CalculoCliente;
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
  const metricas: MetricaReporte[] = noMono
    ? []
    : [
        { key: 'facturacion12m', label: 'Facturación últimos 12 meses', valor: formatCurrency(calc.facturacionUltimos12) },
        { key: 'topeCategoria', label: 'Tope de la categoría', valor: formatCurrency(cat.topeAnual) },
        { key: 'topeConsumido', label: 'Tope consumido', valor: formatPercent(calc.porcentajeTopeActual, 1) },
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
