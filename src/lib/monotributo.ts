import type { Cliente, Categoria, VentanaRecategorizacion } from '@/types';
import {
  CATEGORIAS,
  getCategoria,
  TOPE_CATEGORIA_K,
  RATIO_GASTOS_COMERCIO,
  RATIO_GASTOS_SERVICIOS,
} from '@/data/categorias';
import { differenceInCalendarDays, parseISO } from 'date-fns';

export const HOY = new Date('2026-05-12T12:00:00');

export interface CalculoCliente {
  facturacionUltimos12: number;
  facturacionUltimos12Anualizada: number;
  mesesConActividad: number;
  porcentajeTopeActual: number;
  categoriaCorresponde: Categoria;
  comprasUltimos12: number;
  ratioGastosTopeCatK: number;
  ratioGastosVentas: number;
  ratioUmbralLegal: number;
  ratioSuperadoLegal: boolean;
  fechaProyectadaCruceTope?: string;
  variacionMensualPromedio: number;
  categoriaConInflacion: Categoria;
  diasParaProximaVentana: number;
  proximaVentana?: VentanaRecategorizacion;
}

export function calcularCliente(
  cliente: Cliente,
  ventanas: VentanaRecategorizacion[],
  margenInflacion: number,
): CalculoCliente {
  const ultimos12 = cliente.historialMensual.slice(-12);
  const facturacion12 = ultimos12.reduce(
    (acc, m) => acc + m.emitidasNetas + m.ingresosNoFacturados,
    0,
  );
  const compras12 = ultimos12.reduce((acc, m) => acc + m.recibidasComputables, 0);

  const fechaInicio = parseISO(cliente.fechaInicio);
  const mesesActividad = Math.max(
    1,
    Math.floor(differenceInCalendarDays(HOY, fechaInicio) / 30),
  );
  const mesesEfectivos = Math.min(12, mesesActividad);
  const facturacionAnualizada =
    mesesEfectivos < 12 ? (facturacion12 / mesesEfectivos) * 12 : facturacion12;

  const categoriaActual = getCategoria(cliente.categoria);
  const porcentajeTopeActual = facturacionAnualizada / categoriaActual.topeAnual;

  const categoriaCorresponde =
    CATEGORIAS.find(c => facturacionAnualizada <= c.topeAnual) ||
    CATEGORIAS[CATEGORIAS.length - 1];

  const ratioGastosTopeCatK = compras12 / TOPE_CATEGORIA_K;
  const ratioGastosVentas = facturacion12 > 0 ? compras12 / facturacion12 : 0;
  const ratioUmbralLegal =
    cliente.tipoActividad === 'comercio' ? RATIO_GASTOS_COMERCIO : RATIO_GASTOS_SERVICIOS;
  const ratioSuperadoLegal = ratioGastosTopeCatK > ratioUmbralLegal;

  const ultimos3 = ultimos12.slice(-3);
  const anteriores3 = ultimos12.slice(-6, -3);
  const promUlt3 = ultimos3.reduce((s, m) => s + m.emitidasNetas + m.ingresosNoFacturados, 0) / 3;
  const promAnt3 = anteriores3.reduce((s, m) => s + m.emitidasNetas + m.ingresosNoFacturados, 0) / 3 || promUlt3;
  const variacion = promAnt3 > 0 ? (promUlt3 - promAnt3) / promAnt3 / 3 : 0;

  const fechaProyectada = proyectarCruceTope(
    facturacion12,
    promUlt3,
    variacion,
    categoriaActual.topeAnual,
  );

  const promConInflacion = promUlt3 * (1 + 0.025 + margenInflacion);
  const facturacionConInflacion = promConInflacion * 12;
  const categoriaConInflacion =
    CATEGORIAS.find(c => facturacionConInflacion <= c.topeAnual) ||
    CATEGORIAS[CATEGORIAS.length - 1];

  const ventanasFuturas = ventanas
    .map(v => ({ ...v, dias: differenceInCalendarDays(parseISO(v.fechaLimite), HOY) }))
    .filter(v => v.dias >= 0)
    .sort((a, b) => a.dias - b.dias);
  const proxima = ventanasFuturas[0];

  return {
    facturacionUltimos12: facturacion12,
    facturacionUltimos12Anualizada: facturacionAnualizada,
    mesesConActividad: mesesActividad,
    porcentajeTopeActual,
    categoriaCorresponde,
    comprasUltimos12: compras12,
    ratioGastosTopeCatK,
    ratioGastosVentas,
    ratioUmbralLegal,
    ratioSuperadoLegal,
    fechaProyectadaCruceTope: fechaProyectada?.toISOString(),
    variacionMensualPromedio: variacion,
    categoriaConInflacion,
    diasParaProximaVentana: proxima?.dias ?? Infinity,
    proximaVentana: proxima,
  };
}

function proyectarCruceTope(
  acumulado12: number,
  promedioMensual: number,
  variacion: number,
  tope: number,
): Date | undefined {
  if (acumulado12 >= tope) return undefined;
  let acumulado = acumulado12;
  let prom = promedioMensual;
  const fecha = new Date(HOY);
  for (let i = 0; i < 36; i++) {
    fecha.setMonth(fecha.getMonth() + 1);
    prom = prom * (1 + Math.max(-0.1, Math.min(variacion, 0.2)));
    acumulado += prom;
    if (acumulado >= tope) return fecha;
  }
  return undefined;
}
