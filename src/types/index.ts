export type EstadoAlerta = 'rojo' | 'amarillo' | 'gris' | 'verde';
export type TipoActividad = 'comercio' | 'servicios';
export type CategoriaCodigo =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

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
  comprobanteMatcheadoId?: string;
  marcadoComo?: 'ingreso-actividad' | 'no-es-venta';
  marcadoPorContador?: string;
  marcadoEn?: string;
}

export type TipoComprobante =
  | 'Factura A' | 'Factura B' | 'Factura C'
  | 'Nota Crédito A' | 'Nota Crédito B' | 'Nota Crédito C'
  | 'Nota Débito A' | 'Nota Débito B' | 'Nota Débito C'
  | 'Recibo C';

export interface Comprobante {
  id: string;
  direccion: 'emitido' | 'recibido';
  tipo: TipoComprobante;
  fechaEmision: string;
  periodoDevengado?: string;
  puntoVenta: number;
  numero: string;
  monto: number;
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
}

export interface Cliente {
  id: string;
  nombre: string;
  cuit: string;
  categoria: CategoriaCodigo;
  tipoActividad: TipoActividad;
  fechaInicio: string;
  notas: string;
  estadoAlerta: EstadoAlerta;
  ultimaExtraccion?: string;
  resultadoUltimaExtraccion: 'exitosa' | 'fallida' | 'pendiente';
  motivoFalloUltimaExtraccion?: string;
  estadoCuotaMesActual: 'al-dia' | 'con-deuda';
  historialMensual: HistorialMes[];
  movimientosBancarios: MovimientoBancario[];
  comprobantes: Comprobante[];
  causales: EstadoCausalCliente[];
  extracciones: Extraccion[];
}

export interface VentanaRecategorizacion {
  semestre: 'Enero-Junio' | 'Julio-Diciembre';
  fechaLimite: string;
  efectoDesde: string;
}

export interface Configuracion {
  ventanas: VentanaRecategorizacion[];
  margenInflacionProyeccion: number;
  umbralAmarilloPorcentaje: number;
  umbralAmarilloDias: number;
  umbralRojoDias: number;
  umbralRatioGastosAmarillo: number;
}
