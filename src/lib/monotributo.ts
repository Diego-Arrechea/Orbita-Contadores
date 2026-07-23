import type { Cliente, Categoria, Comprobante, HistorialMes, VentanaRecategorizacion } from '@/types';
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

/**
 * Suma neta de los comprobantes cargados A MANO (origen 'manual') EMITIDOS dentro de la ventana de 12
 * meses calendario. Las notas de crédito restan. Sirve para sumar la carga manual al facturómetro
 * OFICIAL de ARCA (que no la incluye); el cálculo propio por comprobantes ya la tiene contemplada.
 */
export function facturacionManual12m(comprobantes: Comprobante[], hasta: Date = HOY): number {
  const finIdx = hasta.getFullYear() * 12 + hasta.getMonth();
  const desdeIdx = finIdx - 11;
  return comprobantes.reduce((acc, c) => {
    if (c.origen !== 'manual' || c.direccion !== 'emitido') return acc;
    const [y, mo] = c.fechaEmision.slice(0, 7).split('-').map(Number);
    const idx = y * 12 + (mo - 1);
    if (idx < desdeIdx || idx > finIdx) return acc;
    const signo = c.tipo.includes('Nota Crédito') ? -1 : 1;
    return acc + signo * c.monto;
  }, 0);
}

/** Semestre de recategorización del monotributo. El período de 12 meses que se evalúa cierra en junio
 *  (semestre Enero-Junio) o en diciembre (semestre Julio-Diciembre). */
export type Semestre = 'Enero-Junio' | 'Julio-Diciembre';

/** Mes de cierre (día 1) del período de 12 meses que evalúa la recategorización de un semestre:
 *  'Enero-Junio' <anio> cierra en junio de <anio> (evalúa jul<anio-1>–jun<anio>); 'Julio-Diciembre'
 *  <anio> cierra en diciembre de <anio> (evalúa ene<anio>–dic<anio>). */
export function hastaSemestreRecat(semestre: Semestre, anio: number): Date {
  return semestre === 'Enero-Junio' ? new Date(anio, 5, 1) : new Date(anio, 11, 1);
}

/** Semestre de recategorización más reciente ya cerrado respecto de `hoy` (para el default). Jul–dic
 *  → cerró junio de este año (Enero-Junio); ene–jun → cerró diciembre del año anterior (Julio-Diciembre). */
export function semestreRecatActual(hoy: Date = HOY): { semestre: Semestre; anio: number } {
  return hoy.getMonth() >= 6
    ? { semestre: 'Enero-Junio', anio: hoy.getFullYear() }
    : { semestre: 'Julio-Diciembre', anio: hoy.getFullYear() - 1 };
}

/** Facturado NETO de una mitad (6 meses calendario) de la ventana anual de recategorización. */
export interface SemestreFacturado {
  /** Primer y último mes calendario del semestre (día 1). */
  desde: Date;
  hasta: Date;
  /** Facturado NETO (facturas − NC) de esos 6 meses, por comprobantes. */
  facturado: number;
}

export interface FacturadoVentana {
  /** Primer y último mes calendario de la ventana anual (día 1). */
  desde: Date;
  hasta: Date;
  /** Facturado NETO (facturas − NC) del período anual, por comprobantes. */
  facturado: number;
  /** Categoría que le correspondería por ese facturado. */
  categoriaCorresponde: Categoria;
  /** Desglose de la ventana anual en sus dos semestres calendario: el primer medio año y el segundo,
   *  para poder controlar cada mitad contra ARCA. La facturación agropecuaria (dato ANUAL, sin
   *  apertura por mes) NO se prorratea entre semestres: queda incluida sólo en el `facturado` total. */
  semestres: [SemestreFacturado, SemestreFacturado];
}

/** Facturado NETO de los 12 meses calendario que cierran en `hasta`, tomado del historial mensual (que
 *  YA incluye la carga manual) + lo agropecuario, con la categoría que le correspondería, y su desglose
 *  por semestre. Sirve para evaluar la recategorización sobre un período ELEGIDO por el contador; el
 *  facturómetro OFICIAL de ARCA es sólo el rolling de 12 meses a hoy, así que para otras ventanas se
 *  usa el cálculo propio. */
export function facturadoEnVentana(cliente: Cliente, hasta: Date): FacturadoVentana {
  const meses = ventana12Meses(cliente.historialMensual, hasta);
  const finIdx = hasta.getFullYear() * 12 + hasta.getMonth();
  const desdeIdx = finIdx - 11;
  const corteIdx = finIdx - 5; // primer mes del segundo semestre (los últimos 6 meses)
  const idxDe = (m: HistorialMes) => {
    const [y, mo] = m.mes.split('-').map(Number);
    return y * 12 + (mo - 1);
  };
  const netoMes = (m: HistorialMes) => m.emitidasNetas + m.ingresosNoFacturados;
  const facturadoSem1 = meses
    .filter(m => idxDe(m) < corteIdx)
    .reduce((acc, m) => acc + netoMes(m), 0);
  const facturadoSem2 = meses
    .filter(m => idxDe(m) >= corteIdx)
    .reduce((acc, m) => acc + netoMes(m), 0);
  const facturado = facturadoSem1 + facturadoSem2 + (cliente.facturacionAgro12m ?? 0);
  const categoriaCorresponde =
    CATEGORIAS.find(c => facturado <= c.topeAnual) || CATEGORIAS[CATEGORIAS.length - 1];
  const fecha = (idx: number) => new Date(Math.floor(idx / 12), idx % 12, 1);
  return {
    desde: fecha(desdeIdx),
    hasta: fecha(finIdx),
    facturado,
    categoriaCorresponde,
    semestres: [
      { desde: fecha(desdeIdx), hasta: fecha(corteIdx - 1), facturado: facturadoSem1 },
      { desde: fecha(corteIdx), hasta: fecha(finIdx), facturado: facturadoSem2 },
    ],
  };
}

export interface CalculoCliente {
  facturacionUltimos12: number;
  /** Parte de `facturacionUltimos12` que viene de liquidaciones agropecuarias (0 si no aplica). */
  facturacionAgro12m: number;
  /** Parte del facturado 12m que viene de comprobantes cargados A MANO (0 si no hay). Ya está sumada
   *  al `nivelTope`/gauge cuando el número base es el oficial de ARCA (que no la incluye). */
  facturacionManual12m: number;
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

/**
 * Ventana de recategorización armada con la fecha LÍMITE real de ARCA (`recat_ventana_hasta`, ISO).
 * La nueva categoría rige desde el 1° del mes de esa fecha límite (histórico: cierra el 5, rige
 * desde el 1). El semestre se infiere del mes de cierre (feb → Jul-Dic; ago → Ene-Jun).
 */
function ventanaDesdeArca(hastaISO: string): VentanaRecategorizacion {
  const mes = Number(hastaISO.slice(5, 7));
  return {
    semestre: mes >= 1 && mes <= 3 ? 'Julio-Diciembre' : 'Enero-Junio',
    fechaLimite: hastaISO,
    efectoDesde: `${hastaISO.slice(0, 7)}-01`,
  };
}

export function calcularCliente(
  cliente: Cliente,
  ventanas: VentanaRecategorizacion[],
  inflacionMensual: number,
): CalculoCliente {
  const ultimos12 = ventana12Meses(cliente.historialMensual);
  // Facturación agropecuaria (Liquidaciones Electrónicas del agro): NO viene de los comprobantes de
  // 'Mis Comprobantes', así que la sumamos acá para que la facturación 12m del cliente sea completa.
  // 0 para los que no facturan agropecuario → no cambia nada. Ojo doble-conteo: cuando ARCA sí trae
  // el facturómetro oficial, ese ya incluye el agro; por eso el nivelTope usa el oficial (que gana) y
  // sólo cae a esta suma-con-agro cuando el oficial no está (el caso de los clientes agropecuarios).
  const facturacionAgro12m = cliente.facturacionAgro12m ?? 0;
  const facturacion12 =
    ultimos12.reduce((acc, m) => acc + m.emitidasNetas + m.ingresosNoFacturados, 0) +
    facturacionAgro12m;
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
  // Comprobantes cargados a mano: el facturómetro oficial de ARCA no los conoce, así que los sumamos
  // sobre el oficial para que cuenten al medir contra el tope (categoría/proyección/recategorización).
  // El cálculo propio por comprobantes (rama sin oficial) ya los incluye → sólo se suman al oficial.
  const factManual12 = facturacionManual12m(cliente.comprobantes);
  const nivelTope = oficialValido
    ? cliente.facturacion12mOficial! + factManual12
    : facturacionAnualizada;
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

  // Arranca del nivel oficial (lo ya acumulado según ARCA, + carga manual) y proyecta con el ritmo de
  // comprobantes. Sin oficial, `facturacion12` ya incluye la carga manual.
  const fechaProyectada = proyectarCruceTope(
    oficialValido ? cliente.facturacion12mOficial! + factManual12 : facturacion12,
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

  // Ventana de recategorización REAL de ARCA (si la trajimos) por sobre el calendario semestral por
  // defecto: su fecha de cierre es la fecha LÍMITE oficial. De la config sólo conservamos las ventanas
  // POSTERIORES a la real (las siguientes, que ARCA todavía no informó); la del mismo evento —tenga la
  // misma fecha o una prorrogada— queda reemplazada por la real. Así, si ARCA corre la fecha, manda la
  // real y no la hardcodeada. Espejo de services/monotributo.py.
  const ventanaReal = cliente.ventanaRecatHasta ? ventanaDesdeArca(cliente.ventanaRecatHasta) : undefined;
  const ventanasEfectivas = ventanaReal
    ? [ventanaReal, ...ventanas.filter(v => v.fechaLimite > ventanaReal.fechaLimite)]
    : ventanas;
  const ventanasFuturas = ventanasEfectivas
    .map(v => ({ ...v, dias: differenceInCalendarDays(parseISO(v.fechaLimite), HOY) }))
    .filter(v => v.dias >= 0)
    .sort((a, b) => a.dias - b.dias);
  const proxima = ventanasFuturas[0];

  return {
    facturacionUltimos12: facturacion12,
    facturacionAgro12m,
    facturacionManual12m: factManual12,
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
