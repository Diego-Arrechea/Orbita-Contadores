import type {
  Cliente,
  HistorialMes,
  MovimientoBancario,
  Comprobante,
  EstadoCausalCliente,
  Extraccion,
  CategoriaCodigo,
  TipoActividad,
} from '@/types';
import { CAUSALES_EXCLUSION } from './causales';

// Fecha "hoy" del mock: 12 de mayo de 2026
const HOY = '2026-05-12';

function meses13(hasta = '2026-04'): string[] {
  const [yStr, mStr] = hasta.split('-');
  const out: string[] = [];
  let y = Number(yStr);
  let m = Number(mStr);
  for (let i = 0; i < 13; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}

function generarHistorial(
  ventasBase: number,
  comprasBase: number,
  variabilidad = 0.2,
  notasCreditoFrec = 0.15,
): HistorialMes[] {
  const meses = meses13();
  return meses.map((mes, idx) => {
    const seed = (idx + 1) * 7.3 + ventasBase / 100000;
    const ruido = Math.sin(seed) * variabilidad;
    const emitidasBrutas = Math.round(ventasBase * (1 + ruido));
    const tieneNotaCredito = Math.cos(seed * 1.7) > 1 - notasCreditoFrec;
    const notasCredito = tieneNotaCredito ? Math.round(emitidasBrutas * 0.04) : 0;
    const emitidasNetas = emitidasBrutas - notasCredito;
    const recibidas = Math.round(comprasBase * (1 + ruido * 0.6));
    const recibidasComputables = Math.round(recibidas * 0.85);
    return {
      mes,
      emitidasBrutas,
      notasCredito,
      emitidasNetas,
      recibidas,
      recibidasComputables,
      ingresosNoFacturados: 0,
    };
  });
}

function defaultCausales(): EstadoCausalCliente[] {
  return CAUSALES_EXCLUSION.map(c => ({
    codigo: c.codigo,
    activa: c.modo !== 'manual' || ['c5', 'c6', 'c9'].includes(c.codigo),
    estado: 'ok' as const,
    ultimaVerificacion: c.modo === 'manual' ? '2026-04-20' : undefined,
  }));
}

function generarExtracciones(diasAtras: number[]): Extraccion[] {
  return diasAtras.map((d, i) => {
    const fecha = new Date('2026-05-12T03:15:00');
    fecha.setDate(fecha.getDate() - d);
    return {
      id: `ext-${i}`,
      fecha: fecha.toISOString(),
      resultado: 'exitosa',
      duracionMs: 12_000 + Math.round(Math.sin(d) * 5000) + 8000,
    };
  });
}

function generarComprobantesMock(historial: HistorialMes[], cuitsContraparte: string[]): Comprobante[] {
  const out: Comprobante[] = [];
  historial.slice(-4).forEach((mes, mIdx) => {
    const cantEmit = 5 + (mIdx % 3);
    for (let i = 0; i < cantEmit; i++) {
      const contIdx = (i + mIdx) % cuitsContraparte.length;
      out.push({
        id: `${mes.mes}-e-${i}`,
        direccion: 'emitido',
        tipo: i % 7 === 0 && mes.notasCredito > 0 ? 'Nota Crédito C' : 'Factura C',
        fechaEmision: `${mes.mes}-${String(3 + i * 3).padStart(2, '0')}`,
        puntoVenta: 1,
        numero: String(1200 + mIdx * 10 + i).padStart(8, '0'),
        monto: Math.round(mes.emitidasBrutas / cantEmit),
        contraparteNombre: ['Distrib SA', 'Comercio del Sur', 'GlobalLogic Arg', 'Consultora MX', 'Cliente directo'][contIdx % 5],
        contraparteCuit: cuitsContraparte[contIdx],
      });
    }
    const cantRecib = 4 + (mIdx % 2);
    for (let i = 0; i < cantRecib; i++) {
      const contIdx = (i + mIdx + 2) % cuitsContraparte.length;
      out.push({
        id: `${mes.mes}-r-${i}`,
        direccion: 'recibido',
        tipo: i % 3 === 0 ? 'Factura A' : 'Factura B',
        fechaEmision: `${mes.mes}-${String(5 + i * 4).padStart(2, '0')}`,
        puntoVenta: 1,
        numero: String(8000 + mIdx * 10 + i).padStart(8, '0'),
        monto: Math.round(mes.recibidas / cantRecib),
        contraparteNombre: ['Edenor SA', 'Telecom SA', 'YPF SA', 'Mayorista Centro', 'Coworking Palermo'][contIdx % 5],
        contraparteCuit: cuitsContraparte[contIdx],
        esBienPatrimonial: i === 0 && mes.mes === '2026-02' ? true : undefined,
      });
    }
  });
  return out;
}

function generarMovimientos(historial: HistorialMes[]): MovimientoBancario[] {
  const out: MovimientoBancario[] = [];
  historial.slice(-3).forEach((mes, mIdx) => {
    const cant = 6;
    for (let i = 0; i < cant; i++) {
      const isMatcheado = i < 4;
      out.push({
        id: `${mes.mes}-mov-${i}`,
        fecha: `${mes.mes}-${String(2 + i * 4).padStart(2, '0')}`,
        monto: Math.round(mes.emitidasBrutas / cant) + (isMatcheado ? 0 : 15_000 * (i % 3)),
        fuente: i % 2 === 0 ? 'mercadopago' : 'banco',
        cuitOriginante: ['20111222334', '30222333445', '27333444556', '23444555667', '24555666778'][i % 5],
        nombreOriginante: ['Juan Pérez', 'Empresa SRL', 'Comercio Sur', 'María López', 'Cliente Casual'][i % 5],
        comprobanteMatcheadoId: isMatcheado ? `${mes.mes}-e-${i}` : undefined,
        marcadoComo: !isMatcheado && i === 4 ? 'ingreso-actividad' : !isMatcheado && i === 5 ? 'no-es-venta' : undefined,
        marcadoPorContador: !isMatcheado && i >= 4 ? 'Felipe Contador' : undefined,
        marcadoEn: !isMatcheado && i >= 4 ? `${mes.mes}-${String(15 + i).padStart(2, '0')}` : undefined,
      });
    }
  });
  return out;
}

const CUITS_CONTRAPARTE = [
  '20111222334', '30222333445', '27333444556',
  '23444555667', '24555666778', '20666777889',
  '30777888990', '27888999001',
];

interface ClienteSeed {
  id: string;
  nombre: string;
  cuit: string;
  categoria: CategoriaCodigo;
  tipoActividad: TipoActividad;
  fechaInicio: string;
  notas: string;
  ventasBase: number;
  comprasBase: number;
  estadoAlerta: Cliente['estadoAlerta'];
  resultadoUltimaExtraccion: Cliente['resultadoUltimaExtraccion'];
  motivoFalloUltimaExtraccion?: string;
  estadoCuotaMesActual: Cliente['estadoCuotaMesActual'];
  diasUltimaExtraccion: number;
  overrideCausales?: Partial<EstadoCausalCliente>[];
  overrideIngresosNoFacturados?: Record<string, number>;
}

const SEEDS: ClienteSeed[] = [
  {
    id: 'cli-001',
    nombre: 'Laura Giménez',
    cuit: '27358449123',
    categoria: 'F',
    tipoActividad: 'servicios',
    fechaInicio: '2018-03-15',
    notas: 'Diseñadora freelance, clientes internacionales. Pedir resumen MP cada mes.',
    ventasBase: 2_400_000,
    comprasBase: 240_000,
    estadoAlerta: 'rojo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-002',
    nombre: 'Comercial Aragón SRL',
    cuit: '30715998123',
    categoria: 'H',
    tipoActividad: 'comercio',
    fechaInicio: '2015-09-01',
    notas: 'Cliente desde 2019. Despachan a interior. Revisar precio unitario.',
    ventasBase: 4_800_000,
    comprasBase: 3_800_000,
    estadoAlerta: 'rojo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'con-deuda',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-003',
    nombre: 'Martín Sosa',
    cuit: '20289334571',
    categoria: 'K',
    tipoActividad: 'servicios',
    fechaInicio: '2014-01-10',
    notas: 'Desarrollador senior, tope K muy cerca. Habría que evaluar pasaje a RI.',
    ventasBase: 6_500_000,
    comprasBase: 350_000,
    estadoAlerta: 'rojo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-004',
    nombre: 'Florencia Aizpún',
    cuit: '27412556778',
    categoria: 'D',
    tipoActividad: 'servicios',
    fechaInicio: '2020-06-01',
    notas: 'Psicóloga, atiende OS y privados. Acercó el extracto del Galicia.',
    ventasBase: 1_500_000,
    comprasBase: 120_000,
    estadoAlerta: 'amarillo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 2,
    overrideIngresosNoFacturados: { '2026-02': 180_000, '2026-03': 220_000 },
  },
  {
    id: 'cli-005',
    nombre: 'Almacén "La Esquina"',
    cuit: '20301223344',
    categoria: 'G',
    tipoActividad: 'comercio',
    fechaInicio: '2017-04-20',
    notas: 'Mucha compra en mayorista, revisar ratio.',
    ventasBase: 2_300_000,
    comprasBase: 1_900_000,
    estadoAlerta: 'amarillo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-006',
    nombre: 'Nicolás Battaglia',
    cuit: '20382991145',
    categoria: 'E',
    tipoActividad: 'servicios',
    fechaInicio: '2019-11-12',
    notas: 'Consultor IT. Crecimiento sostenido los últimos meses.',
    ventasBase: 1_750_000,
    comprasBase: 95_000,
    estadoAlerta: 'amarillo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-007',
    nombre: 'Carolina Pérez',
    cuit: '27341223891',
    categoria: 'C',
    tipoActividad: 'servicios',
    fechaInicio: '2021-08-01',
    notas: 'Verificar manualmente parámetros físicos del consultorio.',
    ventasBase: 1_200_000,
    comprasBase: 75_000,
    estadoAlerta: 'amarillo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
    overrideCausales: [
      { codigo: 'c5', estado: 'sin-verificar', ultimaVerificacion: '2026-03-15' },
    ],
  },
  {
    id: 'cli-008',
    nombre: 'Estudio Lumen',
    cuit: '30709887445',
    categoria: 'F',
    tipoActividad: 'servicios',
    fechaInicio: '2016-02-15',
    notas: 'Fotógrafos de eventos. Mucha estacionalidad.',
    ventasBase: 2_100_000,
    comprasBase: 180_000,
    estadoAlerta: 'amarillo',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 2,
  },
  {
    id: 'cli-009',
    nombre: 'Mariana Rivero',
    cuit: '27298776112',
    categoria: 'B',
    tipoActividad: 'servicios',
    fechaInicio: '2022-04-10',
    notas: '35 días sin poder extraer. La clave puede haber cambiado.',
    ventasBase: 750_000,
    comprasBase: 50_000,
    estadoAlerta: 'gris',
    resultadoUltimaExtraccion: 'fallida',
    motivoFalloUltimaExtraccion: 'Clave fiscal inválida o vencida',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 35,
  },
  {
    id: 'cli-010',
    nombre: 'Sebastián Olmos',
    cuit: '20276443219',
    categoria: 'D',
    tipoActividad: 'comercio',
    fechaInicio: '2026-04-25',
    notas: 'Recién alta en el sistema, no se logró conectar todavía.',
    ventasBase: 600_000,
    comprasBase: 400_000,
    estadoAlerta: 'gris',
    resultadoUltimaExtraccion: 'fallida',
    motivoFalloUltimaExtraccion: 'Pendiente primera extracción',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 14,
  },
  {
    id: 'cli-011',
    nombre: 'Tienda Online "Sur"',
    cuit: '20336778992',
    categoria: 'E',
    tipoActividad: 'comercio',
    fechaInicio: '2018-12-01',
    notas: 'Venden por MercadoLibre. Buena prolijidad documental.',
    ventasBase: 1_800_000,
    comprasBase: 1_100_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-012',
    nombre: 'Diego Vargas',
    cuit: '20254998112',
    categoria: 'A',
    tipoActividad: 'servicios',
    fechaInicio: '2023-09-15',
    notas: 'Cliente nuevo, profe particular.',
    ventasBase: 380_000,
    comprasBase: 15_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-013',
    nombre: 'Ana Luz Marcic',
    cuit: '27322114558',
    categoria: 'C',
    tipoActividad: 'servicios',
    fechaInicio: '2019-05-08',
    notas: 'Veterinaria, todo en orden.',
    ventasBase: 850_000,
    comprasBase: 60_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-014',
    nombre: 'Kiosco "El Cruce"',
    cuit: '20338991224',
    categoria: 'B',
    tipoActividad: 'comercio',
    fechaInicio: '2020-11-01',
    notas: '',
    ventasBase: 700_000,
    comprasBase: 520_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-015',
    nombre: 'Pablo Iturralde',
    cuit: '20299445667',
    categoria: 'D',
    tipoActividad: 'servicios',
    fechaInicio: '2017-07-22',
    notas: 'Arquitecto, factura mensual estable.',
    ventasBase: 1_450_000,
    comprasBase: 90_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-016',
    nombre: 'Belén Castro',
    cuit: '27308991334',
    categoria: 'E',
    tipoActividad: 'servicios',
    fechaInicio: '2018-09-30',
    notas: 'Traductora, ingresos en dólares principalmente.',
    ventasBase: 1_700_000,
    comprasBase: 85_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-017',
    nombre: 'Distribuidora Norte',
    cuit: '30709112245',
    categoria: 'G',
    tipoActividad: 'comercio',
    fechaInicio: '2014-03-01',
    notas: 'Cliente viejo, sin sobresaltos.',
    ventasBase: 2_500_000,
    comprasBase: 1_700_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-018',
    nombre: 'Inés Quintero',
    cuit: '27381445223',
    categoria: 'A',
    tipoActividad: 'servicios',
    fechaInicio: '2024-11-15',
    notas: 'Recién arrancó, todavía no completó un semestre.',
    ventasBase: 320_000,
    comprasBase: 12_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-019',
    nombre: 'Lucas Méndez',
    cuit: '20311887445',
    categoria: 'F',
    tipoActividad: 'servicios',
    fechaInicio: '2017-05-04',
    notas: 'Productor audiovisual.',
    ventasBase: 2_000_000,
    comprasBase: 200_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
  {
    id: 'cli-020',
    nombre: 'Almacén Don José',
    cuit: '20335998112',
    categoria: 'C',
    tipoActividad: 'comercio',
    fechaInicio: '2019-08-20',
    notas: 'Almacén de barrio. Compra mayormente en efectivo.',
    ventasBase: 1_100_000,
    comprasBase: 820_000,
    estadoAlerta: 'verde',
    resultadoUltimaExtraccion: 'exitosa',
    estadoCuotaMesActual: 'al-dia',
    diasUltimaExtraccion: 1,
  },
];

function construirCliente(seed: ClienteSeed): Cliente {
  const historial = generarHistorial(seed.ventasBase, seed.comprasBase);
  if (seed.overrideIngresosNoFacturados) {
    historial.forEach(h => {
      if (seed.overrideIngresosNoFacturados![h.mes]) {
        h.ingresosNoFacturados = seed.overrideIngresosNoFacturados![h.mes];
      }
    });
  }
  const causales = defaultCausales();
  if (seed.overrideCausales) {
    seed.overrideCausales.forEach(o => {
      const idx = causales.findIndex(c => c.codigo === o.codigo);
      if (idx >= 0) causales[idx] = { ...causales[idx], ...o };
    });
  }
  const fechaUltima = new Date(HOY);
  fechaUltima.setDate(fechaUltima.getDate() - seed.diasUltimaExtraccion);
  const extracciones = generarExtracciones([
    seed.diasUltimaExtraccion,
    seed.diasUltimaExtraccion + 1,
    seed.diasUltimaExtraccion + 2,
    seed.diasUltimaExtraccion + 5,
    seed.diasUltimaExtraccion + 8,
  ]);
  if (seed.resultadoUltimaExtraccion === 'fallida') {
    extracciones[0] = {
      ...extracciones[0],
      resultado: 'fallida',
      motivo: seed.motivoFalloUltimaExtraccion,
    };
  }
  return {
    id: seed.id,
    nombre: seed.nombre,
    cuit: seed.cuit,
    categoria: seed.categoria,
    tipoActividad: seed.tipoActividad,
    fechaInicio: seed.fechaInicio,
    notas: seed.notas,
    estadoAlerta: seed.estadoAlerta,
    ultimaExtraccion: fechaUltima.toISOString(),
    resultadoUltimaExtraccion: seed.resultadoUltimaExtraccion,
    motivoFalloUltimaExtraccion: seed.motivoFalloUltimaExtraccion,
    estadoCuotaMesActual: seed.estadoCuotaMesActual,
    historialMensual: historial,
    comprobantes: generarComprobantesMock(historial, CUITS_CONTRAPARTE),
    movimientosBancarios: ['cli-004', 'cli-005', 'cli-001', 'cli-003', 'cli-011'].includes(seed.id)
      ? generarMovimientos(historial)
      : [],
    causales,
    extracciones,
  };
}

export const CLIENTES: Cliente[] = SEEDS.map(construirCliente);

export function getCliente(id: string): Cliente | undefined {
  return CLIENTES.find(c => c.id === id);
}
