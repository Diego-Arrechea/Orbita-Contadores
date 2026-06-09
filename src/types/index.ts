export type EstadoAlerta = 'rojo' | 'amarillo' | 'gris' | 'verde';
export type TipoActividad = 'comercio' | 'servicios';
export type CategoriaCodigo =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';
// 'no_monotributo' = ARCA confirma que NO es monotributista, pero no es (o no sabemos si es) RI:
// régimen general / exento / empleado / consumidor final. Se distingue de 'responsable_inscripto'
// para no rotular como RI a alguien sin evidencia de serlo (ver src/lib/regimen.ts).
export type Regimen = 'monotributo' | 'responsable_inscripto' | 'no_monotributo';

export interface Categoria {
  codigo: CategoriaCodigo;
  topeAnual: number;
  cuotaServicios: number;
  cuotaComercio: number;
  topePrecioUnitario?: number;
  superficieMax: number;
  energiaMaxKwh: number;
  alquilerMaxAnual: number;
}

export interface HistorialMes {
  mes: string;
  emitidasBrutas: number;
  notasCredito: number;
  emitidasNetas: number;
  recibidas: number;
  recibidasComputables: number;
  ingresosNoFacturados: number;
}

export interface MovimientoBancario {
  id: string;
  fecha: string;
  monto: number;
  fuente: 'banco' | 'mercadopago' | 'otro';
  cuitOriginante?: string;
  nombreOriginante?: string;
  /** Detalle crudo de la fila del extracto (lo trae el backend en clientes reales). */
  descripcion?: string;
  comprobanteMatcheadoId?: string;
  /** Confianza del match automático: alta (monto+CUIT), media (monto exacto), sugerido (tolerancia), manual (forzado por el contador). */
  matchConfianza?: 'alta' | 'media' | 'sugerido' | 'manual';
  marcadoComo?: 'ingreso-actividad' | 'no-es-venta';
  marcadoPorContador?: string;
  marcadoEn?: string;
}

export type TipoComprobante =
  | 'Factura A' | 'Factura B' | 'Factura C' | 'Factura E' | 'Factura M'
  | 'Factura FCE A' | 'Factura FCE B' | 'Factura FCE C'
  | 'Nota Crédito A' | 'Nota Crédito B' | 'Nota Crédito C' | 'Nota Crédito E' | 'Nota Crédito M'
  | 'Nota Crédito FCE A' | 'Nota Crédito FCE B' | 'Nota Crédito FCE C'
  | 'Nota Débito A' | 'Nota Débito B' | 'Nota Débito C' | 'Nota Débito E' | 'Nota Débito M'
  | 'Nota Débito FCE A' | 'Nota Débito FCE B' | 'Nota Débito FCE C'
  | 'Recibo A' | 'Recibo B' | 'Recibo C' | 'Recibo M'
  // El backend puede devolver tiques u otros tipos no mapeados ("Tipo N"); los aceptamos como
  // string sin perder el autocompletado de los literales de arriba.
  | (string & {});

export interface Comprobante {
  id: string;
  direccion: 'emitido' | 'recibido';
  tipo: TipoComprobante;
  fechaEmision: string;
  periodoDevengado?: string;
  puntoVenta: number;
  numero: string;
  monto: number;          // SIEMPRE en pesos (canónico para sumas/tope)
  moneda?: string;        // 'ARS' (default) | 'USD' | … — moneda original del comprobante
  cotizacion?: number;    // tipo de cambio del día de emisión (1 para ARS)
  montoOrigen?: number;   // monto en la moneda original (para mostrar; en pesos == monto)
  contraparteNombre: string;
  contraparteCuit: string;
  esBienPatrimonial?: boolean;
  pdfUrl?: string;
}

export type ModoCausal = 'auto' | 'manual' | 'parcial';
export type EstadoCausal = 'ok' | 'riesgo' | 'superado' | 'sin-verificar';

export interface Causal {
  codigo: string;
  descripcion: string;
  modo: ModoCausal;
}

export interface EstadoCausalCliente {
  codigo: string;
  activa: boolean;
  estado: EstadoCausal;
  ultimaVerificacion?: string;
  observaciones?: string;
}

export interface Extraccion {
  id: string;
  fecha: string;
  resultado: 'exitosa' | 'fallida';
  motivo?: string;
  duracionMs?: number;
  /** Cuántos comprobantes trajo esta sincronización (total procesado en la corrida). */
  comprobantes?: number;
}

export interface Cliente {
  id: string;
  nombre: string;
  cuit: string;
  /** null = no es monotributista (Responsable Inscripto) o no se pudo determinar la categoría. */
  categoria: CategoriaCodigo | null;
  /** Régimen impositivo deducido de los comprobantes que emite (lo trae el backend). */
  regimen?: Regimen;
  tipoActividad: TipoActividad;
  fechaInicio: string;
  notas: string;
  estadoAlerta: EstadoAlerta;
  ultimaExtraccion?: string;
  resultadoUltimaExtraccion: 'exitosa' | 'fallida' | 'pendiente';
  motivoFalloUltimaExtraccion?: string;
  estadoCuotaMesActual: 'al-dia' | 'con-deuda';
  // Detalle real de la cuota (portal Monotributo + CCMA), si es monotributista titular.
  cuotaDeuda?: number;
  cuotaSaldoFavor?: number;
  proxVencFecha?: string;
  proxVencImporte?: number;
  debitoAutomatico?: boolean;
  // Facturómetro oficial del padrón (ARCA): ingresos brutos 12m, tope de su categoría y la fecha de
  // corte que informa ARCA. Numerador/denominador OFICIALES del gauge (el cálculo por comprobantes
  // queda como estimación al día). Sólo titular monotributista.
  facturacion12mOficial?: number;
  topeCategoriaOficial?: number;
  facturometroActualizado?: string;
  historialMensual: HistorialMes[];
  movimientosBancarios: MovimientoBancario[];
  comprobantes: Comprobante[];
  /** El cliente tiene AL MENOS un comprobante en el cache. Lo usa el semáforo del dashboard, donde
   *  `comprobantes` viene vacío (el dashboard no baja el detalle); en la ficha del cliente sobra. */
  tieneComprobantes?: boolean;
  causales: EstadoCausalCliente[];
  extracciones: Extraccion[];
  /** 'arca' = los comprobantes se traen reales del backend (WSFEv1); 'mock'/undefined = datos de prueba. */
  fuente?: 'mock' | 'arca';
}

export interface VentanaRecategorizacion {
  semestre: 'Enero-Junio' | 'Julio-Diciembre';
  fechaLimite: string;
  efectoDesde: string;
}

export interface Configuracion {
  ventanas: VentanaRecategorizacion[];
  /** Inflación mensual estimada para proyectar la facturación a 12 meses (0.02 = 2%/mes; 0 = sin inflación). */
  inflacionMensualProyeccion: number;
  umbralAmarilloPorcentaje: number;
  umbralAmarilloDias: number;
  umbralRojoDias: number;
  umbralRatioGastosAmarillo: number;
  /** Fracción de la cuota del mes a partir de la cual una deuda impaga es urgente (0.10 = 10%).
   *  Por debajo, la deuda se reporta como aviso (no urgente). */
  umbralDeudaCuotaUrgente: number;
}
