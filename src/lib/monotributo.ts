import type { Cliente, Categoria, HistorialMes, VentanaRecategorizacion } from '@/types';
import {
  CATEGORIAS,
  getCategoria,
  TOPE_CATEGORIA_K,
  RATIO_GASTOS_COMERCIO,
  RATIO_GASTOS_SERVICIOS,
} from '@/data/categorias';
import { differenceInCalendarDays, parseISO } from 'date-fns';

// Fecha de referencia para todos los cálculos temporales: días para la ventana de recategorización,
// meses de actividad y proyección de cruce de tope. Es la fecha REAL del momento en que se abre la
// app (si la pestaña queda abierta cruzando la medianoche, se actualiza al recargar).
export const HOY = new Date();

/**
 * Entradas del historial que caen dentro de la ventana de 12 meses CALENDARIO que termina en
 * `hasta` (inclusive). Es la ventana que usa el facturómetro de ARCA: los últimos 12 meses corridos.
 *
 * Por qué NO `historial.slice(-12)`: el historial sólo tiene una fila por mes CON comprobantes (los
 * meses sin facturar no existen, no se rellenan con $0). Entonces `slice(-12)` toma los últimos 12
 * meses *con actividad*, que ante huecos de facturación terminan abarcando 15, 18 o 24 meses
 * calendario reales → suma de más. Anclando a una fecha real nunca sumamos más de 12 meses corridos.
 */
export function ventana12Meses(historial: HistorialMes[], hasta: Date = HOY): HistorialMes[] {
  const finIdx = hasta.getFullYear() * 12 + hasta.getMonth();
  const desdeIdx = finIdx - 11;
  return historial.filter(m => {
    const [y, mo] = m.mes.split('-').map(Number);
    const idx = y * 12 + (mo - 1);
    return idx >= desdeIdx && idx <= finIdx;
  });
}

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
  /** Categoría que tocaría con el MISMO facturado actual pero contra los topes YA actualizados por inflación. */
  categoriaConInflacion: Categoria;
  /** true si actualizar los topes por inflación te deja en una categoría MÁS BAJA que con los topes de hoy (el caso útil). */
  inflacionEvitaSubirCategoria: boolean;
  /** Factor por el que suben los topes al actualizarse por la inflación de 6 meses: (1 + r)^6. */
  factorTopesInflacion: number;
  /** Tope de referencia (el de tu MISMA categoría), YA actualizado por la inflación del semestre. */
  topeReferenciaInflado: number;
  /** % del tope consumido midiendo contra el tope de tu misma categoría ya inflado (baja respecto de hoy). */
  porcentajeTopeInflado: number;
  diasParaProximaVentana: number;
  proximaVentana?: VentanaRecategorizacion;
  // Valores intermedios expuestos para la trazabilidad ("ver detalle"): son los mismos insumos que
  // usan los cálculos de arriba, para poder explicarle al contador de dónde sale cada número sin
  // recalcular (y sin riesgo de que el detalle diverja de lo que se muestra).
  nivelTope: number; // facturación autoritativa usada para tope/categoría (oficial o anualizada propia)
  topeReferencia: number; // tope contra el que se mide (oficial de ARCA o de la tabla)
  promedioMensualUlt3: number; // promedio de los últimos 3 meses (base de la proyección de cruce)
  inflacionMensualUsada: number; // tasa mensual de inflación aplicada a los topes
  topeCategoriaConInflacion: number; // tope de la categoría resultante, YA actualizado por inflación (6m)
}

export function calcularCliente(
  cliente: Cliente,
  ventanas: VentanaRecategorizacion[],
  inflacionMensual: number,
): CalculoCliente {
  const ultimos12 = ventana12Meses(cliente.historialMensual);
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

  // Nivel autoritativo para tope/categoría/proyección: la cifra OFICIAL de ARCA (facturómetro del
  // padrón) cuando está; si no, el cálculo propio por comprobantes (anualizado si <12m de actividad).
  // El oficial ya incluye lo que ARCA computa —p. ej. liquidaciones del agro que el productor NO
  // emite—, así que evita subdeclarar en esas carteras. La TENDENCIA (ritmo/proyección de cruce) sí
  // sigue saliendo de los comprobantes: el oficial es un único total 12m, sin desglose mensual.
  // OJO: sólo se considera válido el oficial > 0. El panel de ARCA a veces responde 0 por una carga
  // incompleta del AJAX (con la fecha de corte ya puesta); ese 0 NO es real (lo delata tener
  // comprobantes por encima) y con `??` ganaría y pisaría todo con $0 → usamos chequeo > 0, no null.
  const oficialValido = cliente.facturacion12mOficial != null && cliente.facturacion12mOficial > 0;
  const topeOficialValido = cliente.topeCategoriaOficial != null && cliente.topeCategoriaOficial > 0;
  const nivelTope = oficialValido ? cliente.facturacion12mOficial! : facturacionAnualizada;
  const topeRef = topeOficialValido ? cliente.topeCategoriaOficial! : categoriaActual.topeAnual;
  const porcentajeTopeActual = topeRef > 0 ? nivelTope / topeRef : 0;

  const categoriaCorresponde =
    CATEGORIAS.find(c => nivelTope <= c.topeAnual) ||
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

  // Arranca del nivel oficial (lo ya acumulado según ARCA) y proyecta con el ritmo de comprobantes.
  const fechaProyectada = proyectarCruceTope(
    oficialValido ? cliente.facturacion12mOficial! : facturacion12,
    promUlt3,
    variacion,
    topeRef,
  );

  // "Ajustado por inflación": el FACTURADO no cambia (es el de los últimos 12 meses); lo que sube es
  // el TOPE de tu MISMA categoría, que se actualiza cada SEMESTRE por la inflación acumulada de esos
  // 6 meses. La vista muestra el mismo facturado contra ese tope inflado (baja el % consumido: te da
  // aire). No cambiamos la categoría mostrada — comparar tope-hoy vs tope-inflado de la MISMA
  // categoría es lo intuitivo para el contador.
  const r = inflacionMensual;
  const factorTopesProx = (1 + r) ** 6;
  const topeReferenciaInflado = topeRef * factorTopesProx;
  const porcentajeTopeInflado = topeRef > 0 ? nivelTope / topeReferenciaInflado : 0;
  // Bajo el capó igual calculamos en qué categoría caería el MISMO facturado contra los topes ya
  // inflados: si es una más baja que la que te tocaría hoy, la inflación te evita recategorizar para
  // arriba. Ese dato alimenta el cartel "te evita subir", sin cambiar la categoría/tope que se muestran.
  const categoriaConInflacion =
    CATEGORIAS.find(c => nivelTope <= c.topeAnual * factorTopesProx) ||
    CATEGORIAS[CATEGORIAS.length - 1];
  const topeCategoriaConInflacion = categoriaConInflacion.topeAnual * factorTopesProx;
  const inflacionEvitaSubirCategoria =
    CATEGORIAS.indexOf(categoriaConInflacion) < CATEGORIAS.indexOf(categoriaCorresponde);

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
    inflacionEvitaSubirCategoria,
    factorTopesInflacion: factorTopesProx,
    topeReferenciaInflado,
    porcentajeTopeInflado,
    diasParaProximaVentana: proxima?.dias ?? Infinity,
    proximaVentana: proxima,
    nivelTope,
    topeReferencia: topeRef,
    promedioMensualUlt3: promUlt3,
    inflacionMensualUsada: r,
    topeCategoriaConInflacion,
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
