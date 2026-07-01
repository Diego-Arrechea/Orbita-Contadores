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
  cbteTipo?: number;       // código numérico ARCA (11 Factura C, 13 NC C…); sólo en comprobantes del backend
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
  tienePdf?: boolean;      // emitido desde la app → se puede descargar su representación impresa (PDF)
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
  /** ¿Tiene relación de dependencia (trabajo en blanco)? Lo marca el contador (o se auto-detecta).
   *  Sirve para justificar parte de las compras a consumidor final con el haber percibido. */
  relacionDependencia: boolean;
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
  /** Facturación electrónica habilitada (certificado ya generado). Define si el botón de la ficha
   *  dice "Habilitar facturación" (false) o "Emitir comprobante" (true). */
  tieneFacturacion?: boolean;
  /** ARCA le pide al cliente cambiar su Clave Fiscal (campaña de seguridad de AFIP). Mientras esté en
   *  true no se puede actualizar la info del cliente: el contador tiene que avisarle que la cambie. */
  claveRequiereCambio?: boolean;
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

/** Tipos de alerta que el contador puede elegir recibir por WhatsApp. Incluye 'vencimiento' (aviso
 *  de cuota próxima a vencer), que el motor de notificaciones genera aunque no se muestre como alerta
 *  en la app. El resto coincide con `TipoAlerta` de src/lib/alertas.ts. */
export type TipoNotificable =
  | 'tope'
  | 'recategorizacion'
  | 'ventana'
  | 'exclusion'
  | 'cuota'
  | 'vencimiento'
  | 'sync';

/** Preferencias del CANAL de alertas por WhatsApp (sólo cómo/cuándo se entrega). El "qué" y "con qué
 *  criterio" vive en `ConfigAlertas` (por tipo). El motor del backend (services/alertas.py) lo respeta. */
export interface ConfigNotificaciones {
  /** Recibir alertas por WhatsApp (interruptor maestro del canal). */
  activo: boolean;
  /** Ventana horaria disponible para recibir avisos (hora AR, 0–23). desde === hasta = todo el día. */
  horaDesde: number;
  horaHasta: number;
}

/** Configuración POR TIPO de alerta: si se avisa, con qué criterio (umbral) y —en las numéricas— cada
 *  cuánto % de subida se vuelve a avisar. El criterio es ÚNICO: rige el semáforo de la app y el WhatsApp. */
export interface ConfigAlertas {
  /** Cerca/superó el tope. `avisarPct`: fracción del tope para el aviso (0.80 = 80%). `proyeccionCruce`:
   *  avisar si se proyecta cruzar el tope. `reavisarSubidaPct`: re-avisar al subir otra fracción del tope. */
  tope: { activo: boolean; avisarPct: number; proyeccionCruce: boolean; reavisarSubidaPct: number };
  /** Debería recategorizarse (binario). */
  recategorizacion: { activo: boolean };
  /** Cierre de ventana de recategorización: días antes para aviso / para urgente. */
  ventana: { activo: boolean; avisoDias: number; urgenteDias: number };
  /** Gastos altos / riesgo de exclusión. `avisarRatioPct`: fracción del tope K para el aviso. */
  exclusion: { activo: boolean; avisarRatioPct: number; reavisarSubidaPct: number };
  /** Cuota impaga. `urgenteDesdePct`: fracción de la cuota a partir de la cual la deuda es urgente. */
  cuota: { activo: boolean; urgenteDesdePct: number; reavisarSubidaPct: number };
  /** Vencimiento de cuota próximo: cuántos días antes avisar. */
  vencimiento: { activo: boolean; avisarDiasAntes: number };
  /** No pudimos actualizar sus datos (binario). */
  sync: { activo: boolean };
}

/** Inflación mensual esperada según el mercado (mediana del REM), que el panel trae como base de las proyecciones. */
export interface InflacionMercado {
  mensual: number; // tasa mensual equivalente (0.0176 = 1,76%)
  interanual: number; // variación i.a. esperada (0.233 = 23,3%)
  fecha: string; // fecha del dato (ISO)
  fuente: string; // "REM"
}

export interface Configuracion {
  ventanas: VentanaRecategorizacion[];
  /** Inflación mensual MANUAL para proyectar la facturación a 12 meses (0.02 = 2%/mes; 0 = sin inflación). Se usa sólo si inflacionAuto = false. */
  inflacionMensualProyeccion: number;
  /** Si true (default), la proyección usa la inflación esperada del mercado; si false, usa inflacionMensualProyeccion. */
  inflacionAuto: boolean;
  /** Criterio por tipo de alerta (umbral + re-aviso). Reemplaza los umbrales globales. */
  alertas: ConfigAlertas;
  /** Canal de entrega por WhatsApp (interruptor maestro + horario). */
  notificaciones: ConfigNotificaciones;
}
