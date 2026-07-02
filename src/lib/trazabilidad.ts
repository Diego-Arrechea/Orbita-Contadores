/**
 * Trazabilidad de cálculos ("ver detalle").
 *
 * Cada valor calculado que ve el contador en la ficha del cliente puede explicarse: qué representa,
 * con qué fórmula, qué datos se usaron, de qué período y de qué fuente. Este módulo arma esas
 * explicaciones a partir de los MISMOS números que ya calculó `calcularCliente` (no recalcula nada),
 * así el detalle nunca diverge de lo que se muestra en pantalla.
 *
 * Regla de producto: la copy habla en términos contables/impositivos (comprobantes, notas de crédito,
 * tope, escala oficial), nunca del mecanismo de obtención del dato.
 */
import type { Cliente } from '@/types';
import { type CalculoCliente, ventana12Meses, HOY } from '@/lib/monotributo';
import { getCategoria, TOPE_CATEGORIA_K } from '@/data/categorias';
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils';

export interface InsumoCalculo {
  etiqueta: string;
  valor: string;
  nota?: string;
}

export interface TerminoGlosario {
  termino: string;
  detalle: string;
}

export interface DetalleCalculo {
  titulo: string;
  resumen: string;
  formula?: string;
  insumos?: InsumoCalculo[];
  glosario?: TerminoGlosario[];
  periodo?: string;
  fuente?: string;
  nota?: string;
}

/** Etiqueta del período: los 12 meses calendario que terminan en el mes en curso (ej. "jul 2025 – jun 2026"). */
function ventana12mLabel(): string {
  const ini = new Date(HOY.getFullYear(), HOY.getMonth() - 11, 1);
  const fin = new Date(HOY.getFullYear(), HOY.getMonth(), 1);
  const fmt = (d: Date) => d.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
  return `${fmt(ini)} – ${fmt(fin)}`;
}

export interface DetallesSituacion {
  facturacion12m: DetalleCalculo;
  porcentajeTope: DetalleCalculo;
  recategorizacion: DetalleCalculo;
  proyeccionCruce: DetalleCalculo;
  proximaVentana: DetalleCalculo;
  ratioGastos: DetalleCalculo;
  proyeccionInflacion: DetalleCalculo;
  cuota: DetalleCalculo;
}

/** Arma el "ver detalle" de cada valor del tab "Situación actual". */
export function detallesSituacion(cliente: Cliente, calc: CalculoCliente): DetallesSituacion {
  const periodo = ventana12mLabel();
  const v = ventana12Meses(cliente.historialMensual);
  const brutas = v.reduce((s, m) => s + m.emitidasBrutas, 0);
  const nc = v.reduce((s, m) => s + m.notasCredito, 0);
  const noFact = v.reduce((s, m) => s + m.ingresosNoFacturados, 0);
  const compras = v.reduce((s, m) => s + m.recibidasComputables, 0);

  const tieneOficial = cliente.facturacion12mOficial != null && cliente.facturacion12mOficial > 0;
  const catActual = getCategoria(cliente.categoria);
  const catSugerida = calc.categoriaCorresponde;
  const codCat = cliente.categoria ?? catActual.codigo;

  const facturacion12m: DetalleCalculo = tieneOficial
    ? {
        titulo: 'Facturación de los últimos 12 meses',
        resumen:
          'Total facturado en los últimos 12 meses corridos. Es la base para ubicar la categoría y medir cuánto del tope llevás consumido.',
        formula: 'Total anual oficial que informa ARCA (facturómetro del padrón de Monotributo).',
        insumos: [
          { etiqueta: 'Total oficial', valor: formatCurrency(cliente.facturacion12mOficial!) },
          {
            etiqueta: 'Estimado por comprobantes',
            valor: formatCurrency(calc.facturacionUltimos12),
            nota: 'suma de comprobantes emitidos netos',
          },
        ],
        periodo,
        fuente: 'Dato oficial de ARCA',
        nota: cliente.facturometroActualizado
          ? `Actualizado al ${cliente.facturometroActualizado}.`
          : undefined,
      }
    : {
        titulo: 'Facturación de los últimos 12 meses',
        resumen:
          'Total facturado en los últimos 12 meses corridos. Es la base para ubicar la categoría y medir cuánto del tope llevás consumido.',
        formula:
          'Comprobantes emitidos − notas de crédito' +
          (noFact > 0 ? ' + ingresos no facturados marcados' : '') +
          (calc.mesesConActividad < 12
            ? ', anualizado por tener menos de 12 meses de actividad'
            : ''),
        insumos: [
          { etiqueta: 'Comprobantes emitidos (brutos)', valor: formatCurrency(brutas) },
          { etiqueta: 'Notas de crédito', valor: `− ${formatCurrency(nc)}` },
          { etiqueta: 'Emitido neto', valor: formatCurrency(brutas - nc) },
          ...(noFact > 0
            ? [{ etiqueta: 'Ingresos no facturados', valor: formatCurrency(noFact) }]
            : []),
          ...(calc.mesesConActividad < 12
            ? [
                { etiqueta: 'Meses con actividad', valor: String(calc.mesesConActividad) },
                {
                  etiqueta: 'Anualizado',
                  valor: formatCurrency(calc.facturacionUltimos12Anualizada),
                },
              ]
            : []),
        ],
        periodo,
        fuente: 'Comprobantes emitidos',
      };

  const porcentajeTope: DetalleCalculo = {
    titulo: '% del tope consumido',
    resumen: 'Cuánto de tu límite anual de facturación llevás usado en los últimos 12 meses.',
    formula: 'Facturación 12 meses ÷ tope anual de tu categoría',
    insumos: [
      { etiqueta: 'Facturación 12 meses', valor: formatCurrency(calc.nivelTope) },
      { etiqueta: `Tope categoría ${codCat}`, valor: formatCurrency(calc.topeReferencia) },
      { etiqueta: 'Consumido', valor: formatPercent(calc.porcentajeTopeActual, 1) },
    ],
    periodo,
    fuente: tieneOficial
      ? 'Facturación oficial de ARCA · tope de la escala vigente'
      : 'Comprobantes emitidos · tope de la escala vigente',
  };

  const recategorizacion: DetalleCalculo = {
    titulo: 'Categoría que correspondería',
    resumen:
      catSugerida.codigo === cliente.categoria
        ? 'Con tu facturación actual te mantenés en tu categoría.'
        : 'Con tu facturación actual deberías recategorizarte.',
    formula:
      'Primera categoría de la escala oficial cuyo tope anual cubre tu facturación de 12 meses.',
    insumos: [
      { etiqueta: 'Facturación 12 meses', valor: formatCurrency(calc.nivelTope) },
      { etiqueta: 'Categoría actual', valor: codCat },
      {
        etiqueta: 'Categoría que corresponde',
        valor: `${catSugerida.codigo} (hasta ${formatCurrency(catSugerida.topeAnual)})`,
      },
    ],
    fuente: 'Escala oficial de Monotributo vigente',
  };

  const proyeccionCruce: DetalleCalculo = {
    titulo: 'Proyección de cruce de tope',
    resumen: calc.fechaProyectadaCruceTope
      ? 'Fecha estimada en la que, manteniendo tu ritmo actual, tu facturación alcanzaría el tope de la categoría.'
      : 'Al ritmo actual no se proyecta que cruces el tope en los próximos 3 años.',
    formula:
      'Se proyecta el promedio de los últimos 3 meses hacia adelante, ajustado por la tendencia reciente, hasta acumular el tope.',
    insumos: [
      { etiqueta: 'Promedio últimos 3 meses', valor: formatCurrency(calc.promedioMensualUlt3) },
      { etiqueta: 'Tendencia mensual', valor: formatPercent(calc.variacionMensualPromedio, 1) },
      { etiqueta: 'Tope de referencia', valor: formatCurrency(calc.topeReferencia) },
      ...(calc.fechaProyectadaCruceTope
        ? [{ etiqueta: 'Cruce estimado', valor: formatDate(calc.fechaProyectadaCruceTope, 'long') }]
        : []),
    ],
    nota: 'Es una estimación según tu ritmo reciente; se actualiza a medida que facturás.',
  };

  const proximaVentana: DetalleCalculo = {
    titulo: 'Próxima ventana de recategorización',
    resumen: 'Días que faltan para el próximo período en que se puede recategorizar.',
    formula: 'Diferencia entre hoy y la fecha límite de la próxima ventana semestral.',
    insumos: calc.proximaVentana
      ? [
          { etiqueta: 'Fecha límite', valor: formatDate(calc.proximaVentana.fechaLimite, 'long') },
          { etiqueta: 'Semestre', valor: String(calc.proximaVentana.semestre) },
          {
            etiqueta: 'Días restantes',
            valor: Number.isFinite(calc.diasParaProximaVentana)
              ? String(calc.diasParaProximaVentana)
              : '—',
          },
        ]
      : [{ etiqueta: 'Días restantes', valor: '—' }],
    fuente: 'Calendario de recategorización de Monotributo',
  };

  const ratioGastos: DetalleCalculo = {
    titulo: 'Ratio compras / tope categoría K',
    resumen:
      'Controla la causal de exclusión por compras: lo comprado en 12 meses frente al tope de la categoría más alta (K).',
    formula: 'Compras 12 meses ÷ tope de la categoría K',
    insumos: [
      { etiqueta: 'Compras 12 meses', valor: formatCurrency(compras) },
      { etiqueta: 'Tope categoría K', valor: formatCurrency(TOPE_CATEGORIA_K) },
      { etiqueta: 'Ratio', valor: formatPercent(calc.ratioGastosTopeCatK, 1) },
      { etiqueta: `Umbral legal (${cliente.tipoActividad})`, valor: formatPercent(calc.ratioUmbralLegal) },
      { etiqueta: '¿Supera el umbral?', valor: calc.ratioSuperadoLegal ? 'Sí' : 'No' },
    ],
    periodo,
    fuente: 'Compras computables · umbral del art. 20 inc. j (Monotributo)',
  };

  const proyeccionInflacion: DetalleCalculo = {
    titulo: 'Ajustado por inflación',
    resumen:
      'Cuánto del tope consumís cuando se actualiza el tope de TU categoría por la inflación del semestre (el ajuste que ARCA hace cada 6 meses). El facturado no cambia; sólo sube el tope, así que el porcentaje consumido baja.',
    formula:
      'Facturación de los últimos 12 meses ÷ (tope de tu categoría × inflación acumulada de 6 meses).',
    insumos: [
      { etiqueta: 'Facturación últimos 12 meses', valor: formatCurrency(calc.nivelTope) },
      { etiqueta: `Tope categoría ${codCat} (hoy)`, valor: formatCurrency(calc.topeReferencia) },
      { etiqueta: 'Inflación mensual estimada', valor: formatPercent(calc.inflacionMensualUsada, 1) },
      {
        etiqueta: 'Tope actualizado (6 meses)',
        valor: formatCurrency(calc.topeReferenciaInflado),
      },
      { etiqueta: 'Consumido', valor: formatPercent(calc.porcentajeTopeInflado, 1) },
      ...(calc.inflacionEvitaSubirCategoria
        ? [
            {
              etiqueta: 'Efecto en la categoría',
              valor: `Te evita subir a ${catSugerida.codigo}`,
              nota: 'con el mismo facturado, el tope actualizado te mantiene en una categoría más baja',
            },
          ]
        : []),
    ],
    nota: 'La inflación mensual se toma de las expectativas de mercado (o del valor que fijes en los ajustes del estudio).',
  };

  const usaImporteReal = cliente.proxVencImporte != null;
  const importeCuota =
    cliente.proxVencImporte ??
    (cliente.tipoActividad === 'servicios' ? catActual.cuotaServicios : catActual.cuotaComercio);
  const cuota: DetalleCalculo = {
    titulo: 'Cuota del mes',
    resumen:
      'El importe mensual de monotributo: impuesto integrado más aportes (jubilación y obra social).',
    formula: usaImporteReal
      ? 'Importe real informado por ARCA para el período en curso.'
      : `Total de la categoría ${codCat} (${cliente.tipoActividad}) según la escala oficial.`,
    insumos: [
      { etiqueta: 'Importe', valor: formatCurrency(importeCuota) },
      ...(cliente.proxVencFecha ? [{ etiqueta: 'Vence', valor: cliente.proxVencFecha }] : []),
      {
        etiqueta: 'Estado',
        valor: cliente.estadoCuotaMesActual === 'al-dia' ? 'Al día' : 'Con deuda',
      },
      ...(cliente.cuotaDeuda
        ? [{ etiqueta: 'Deuda de cuota', valor: formatCurrency(cliente.cuotaDeuda) }]
        : []),
      ...(cliente.cuotaSaldoFavor && cliente.cuotaSaldoFavor > 0
        ? [{ etiqueta: 'Saldo a favor', valor: formatCurrency(cliente.cuotaSaldoFavor) }]
        : []),
    ],
    fuente: usaImporteReal ? 'Dato oficial de ARCA' : 'Escala oficial de Monotributo vigente',
  };

  return {
    facturacion12m,
    porcentajeTope,
    recategorizacion,
    proyeccionCruce,
    proximaVentana,
    ratioGastos,
    proyeccionInflacion,
    cuota,
  };
}

/** "Ver detalle" del tab "Histórico mensual": explica cada columna de la tabla. */
export const detalleHistorico: DetalleCalculo = {
  titulo: 'Cómo se arma el histórico mensual',
  resumen:
    'Cada fila resume tus comprobantes de ese mes calendario. La facturación que cuenta para el tope es la neta.',
  glosario: [
    { termino: 'Emitidas brutas', detalle: 'Suma de los comprobantes emitidos en el mes, sin descontar nada.' },
    { termino: 'NC (notas de crédito)', detalle: 'Notas de crédito emitidas; se restan de las brutas.' },
    {
      termino: 'Emitidas netas',
      detalle: 'Emitidas brutas − notas de crédito. Es lo que suma para tu tope.',
    },
    {
      termino: 'Ingresos no fact.',
      detalle: 'Ingresos que marcaste manualmente como actividad aunque no tengan comprobante.',
    },
    { termino: 'Recibidas', detalle: 'Comprobantes recibidos de proveedores en el mes.' },
    {
      termino: 'Computables ratio',
      detalle: 'Compras que cuentan para el ratio de exclusión por gastos.',
    },
  ],
  fuente: 'Comprobantes emitidos y recibidos, agrupados por mes',
};

/** "Ver detalle" del tab "Reconciliación bancaria": explica el cruce y los estados. */
export const detalleConciliacion: DetalleCalculo = {
  titulo: 'Cómo se concilian los movimientos',
  resumen:
    'Cada acreditación del extracto se cruza automáticamente con tus comprobantes emitidos para detectar ingresos sin respaldo.',
  formula:
    'Se busca una factura por importe y CUIT del originante, dentro de una ventana de fechas cercana al comprobante.',
  glosario: [
    { termino: 'Match automático', detalle: 'La acreditación coincide con una factura emitida.' },
    {
      termino: 'Confianza alta / media',
      detalle: 'Coincidencia por importe y CUIT (alta) o sólo por importe (media).',
    },
    {
      termino: 'Sugerido (a confirmar)',
      detalle:
        'Coincidencia aproximada por una pequeña tolerancia (p. ej. comisiones); requiere tu confirmación.',
    },
    {
      termino: 'Pendiente revisión',
      detalle: 'No se encontró factura: lo clasificás como ingreso de actividad o como no-venta.',
    },
  ],
  nota: 'Sólo se consideran las acreditaciones (montos positivos); los débitos se descartan.',
};
