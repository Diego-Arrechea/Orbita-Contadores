import type {
  Cliente,
  Comprobante,
  CategoriaCodigo,
  TipoActividad,
  Extraccion,
  HistorialMes,
  Regimen,
} from '@/types';
import { CATEGORIAS } from '@/data/categorias';
import { derivarHistorial } from '@/lib/derivarHistorial';
import { ventana12Meses } from '@/lib/monotributo';
import { apiGet, apiPut, apiDelete } from './apiClient';
import { getComprobantesReales } from './comprobantesService';

interface ClienteBackend {
  cuit: string;
  nombre: string;
  regimen?: string | null; // monotributo | responsable_inscripto | null
  categoria?: string | null;
  actividad?: string | null;
  prox_recategorizacion?: string | null;
  cuota_estado?: string | null;
  cuota_deuda?: number | null;
  cuota_saldo_favor?: number | null;
  prox_venc_fecha?: string | null;
  prox_venc_importe?: number | null;
  debito_automatico?: boolean | null;
  meses_adeudados?: number | null;
  facturacion_12m?: number | null;
  tope_categoria?: number | null;
  facturometro_actualizado?: string | null;
  ultima_extraccion?: string | null;
  resultado_ultima_extraccion?: string | null;
  motivo_ultima_extraccion?: string | null;
  notas?: string | null; // edición del contador (override en la cuenta)
  fecha_inicio?: string | null; // edición del contador (override en la cuenta)
  relacion_dependencia?: boolean | null; // tiene relación de dependencia (override manual o auto)
  // Historial mensual ya agregado por el backend (últimos 12 meses). El dashboard lo consume sin
  // tener que bajar todos los comprobantes; la ficha del cliente sigue bajando el detalle aparte.
  historial_mensual?: HistorialMes[] | null;
  tiene_comprobantes?: boolean | null;
  tiene_facturacion?: boolean | null;
  clave_requiere_cambio?: boolean | null; // ARCA le pide al cliente cambiar su Clave Fiscal
  clave_invalida?: boolean | null; // la Clave Fiscal guardada no es válida (hay que corregirla)
  factura_agro?: boolean | null; // factura por el sector agropecuario (Liquidaciones Electrónicas)
  facturacion_agro_12m?: number | null; // suma de liquidaciones agro de los últimos 12 meses
  facturacion_agro_total?: number | null; // histórico de liquidaciones agro
  activo?: boolean | null; // ¿el contador tiene activo el monitoreo del cliente?
}

const CODIGOS: CategoriaCodigo[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

/** Categoría que le corresponde por su facturación anual (fallback si no tenemos la real). */
function inferirCategoria(facturacion12: number): CategoriaCodigo {
  const cat =
    CATEGORIAS.find(c => facturacion12 <= c.topeAnual) ?? CATEGORIAS[CATEGORIAS.length - 1];
  return cat.codigo;
}

/** Construye un `Cliente` (el tipo del frontend) a partir de los datos reales del backend.
 *
 * `comprobantes` puede venir vacío cuando se arma la cartera del dashboard: en ese caso usamos
 * `bk.historial_mensual` (agregado server-side) para no bajar el detalle por cliente. La ficha
 * del cliente sigue pasando comprobantes completos y derivando el historial localmente. */
function construirCliente(
  bk: ClienteBackend,
  comprobantes: Comprobante[],
  extracciones: Extraccion[] = [],
): Cliente {
  const historialMensual =
    comprobantes.length > 0 || !bk.historial_mensual
      ? derivarHistorial(comprobantes)
      : bk.historial_mensual;
  const fact12 = ventana12Meses(historialMensual).reduce((s, m) => s + m.emitidasNetas, 0);
  const primerMes = historialMensual[0]?.mes;
  // Categoría REAL del padrón de ARCA (si la trajimos); si no, null por ahora.
  const catReal: CategoriaCodigo | null =
    bk.categoria && CODIGOS.includes(bk.categoria as CategoriaCodigo)
      ? (bk.categoria as CategoriaCodigo)
      : null;
  // Régimen: lo resuelve el backend (padrón autoritativo + inferencia por comprobantes). Si no vino
  // o no hay evidencia de monotributo, NO asumimos monotributo: antes se inventaba Cat. A para un
  // no-monotributista (facturación 0 → categoría más baja). Ahora queda 'no_monotributo'.
  const regimen: Regimen =
    bk.regimen === 'monotributo' || catReal
      ? 'monotributo'
      : bk.regimen === 'responsable_inscripto'
        ? 'responsable_inscripto'
        : 'no_monotributo';
  // La categoría sólo aplica a monotributistas: la real del padrón, o inferida por facturación si
  // es monotributista sin ese dato. Para no-monotributistas: null (no se inventa).
  const categoria: CategoriaCodigo | null =
    catReal ?? (regimen === 'monotributo' ? inferirCategoria(fact12) : null);
  const tipoActividad: TipoActividad =
    bk.actividad === 'comercio' || bk.actividad === 'servicios' ? bk.actividad : 'servicios';
  return {
    id: bk.cuit,
    nombre: bk.nombre,
    cuit: bk.cuit,
    categoria,
    regimen,
    tipoActividad,
    // Override del contador (guardado en la cuenta) o el derivado: la fecha del primer comprobante.
    fechaInicio: bk.fecha_inicio ?? (primerMes ? `${primerMes}-01` : '2020-01-01'),
    notas: bk.notas ?? '',
    relacionDependencia: bk.relacion_dependencia ?? false,
    estadoAlerta: 'verde',
    ultimaExtraccion: bk.ultima_extraccion ?? undefined,
    resultadoUltimaExtraccion:
      (bk.resultado_ultima_extraccion as Cliente['resultadoUltimaExtraccion']) ?? 'pendiente',
    motivoFalloUltimaExtraccion: bk.motivo_ultima_extraccion ?? undefined,
    estadoCuotaMesActual: bk.cuota_estado === 'con-deuda' ? 'con-deuda' : 'al-dia',
    cuotaDeuda: bk.cuota_deuda ?? undefined,
    cuotaSaldoFavor: bk.cuota_saldo_favor ?? undefined,
    proxVencFecha: bk.prox_venc_fecha ?? undefined,
    proxVencImporte: bk.prox_venc_importe ?? undefined,
    debitoAutomatico: bk.debito_automatico ?? undefined,
    mesesAdeudados: bk.meses_adeudados ?? undefined,
    facturacion12mOficial: bk.facturacion_12m ?? undefined,
    topeCategoriaOficial: bk.tope_categoria ?? undefined,
    facturometroActualizado: bk.facturometro_actualizado ?? undefined,
    historialMensual,
    movimientosBancarios: [],
    comprobantes,
    // Flag para que el semáforo distinga "sin datos" de "no se bajaron los comprobantes (dashboard)".
    // En la ficha del cliente, comprobantes viene completo y este flag pasa a sobrarle.
    tieneComprobantes: bk.tiene_comprobantes ?? comprobantes.length > 0,
    tieneFacturacion: bk.tiene_facturacion ?? false,
    claveRequiereCambio: bk.clave_requiere_cambio ?? false,
    claveInvalida: bk.clave_invalida ?? false,
    facturaAgro: bk.factura_agro ?? false,
    facturacionAgro12m: bk.facturacion_agro_12m ?? 0,
    facturacionAgroTotal: bk.facturacion_agro_total ?? 0,
    activo: bk.activo ?? true,
    causales: [],
    extracciones,
    fuente: 'arca',
  };
}

/** Todos los clientes reales (los registrados en el backend), con su historial 12m ya agregado
 *  por el backend. NO baja los comprobantes detallados (eso es ~N requests pesados y sólo se
 *  necesita en la ficha): el dashboard alcanza con `historial_mensual`. */
export async function getClientesReales(): Promise<Cliente[]> {
  const lista = await apiGet<ClienteBackend[]>('/clientes');
  return lista.map(bk => construirCliente(bk, []));
}

/** Un cliente real por CUIT (para la ficha cuando no está en el mock). */
export async function getClienteReal(cuit: string): Promise<Cliente | null> {
  const lista = await apiGet<ClienteBackend[]>('/clientes');
  const bk = lista.find(c => c.cuit === cuit);
  if (!bk) return null;
  const [comprobantes, extracciones] = await Promise.all([
    getComprobantesReales(cuit),
    getExtraccionesReales(cuit),
  ]);
  return construirCliente(bk, comprobantes, extracciones);
}

/** El historial de sincronizaciones (extracciones) de un cliente real, más reciente primero. */
export async function getExtraccionesReales(cuit: string): Promise<Extraccion[]> {
  return apiGet<Extraccion[]>(`/clientes/${cuit.replace(/\D/g, '')}/extracciones`);
}

/** Elimina un cliente real del backend (borra el cliente y su cache de comprobantes). */
export async function eliminarCliente(
  cuit: string,
): Promise<{ cuit: string; comprobantes_eliminados: number }> {
  return apiDelete(`/clientes/${cuit.replace(/\D/g, '')}`);
}

export type CamposEdicion = Partial<
  Pick<
    Cliente,
    | 'nombre'
    | 'categoria'
    | 'tipoActividad'
    | 'fechaInicio'
    | 'estadoCuotaMesActual'
    | 'notas'
    | 'relacionDependencia'
  >
>;

/** Guarda en la cuenta las ediciones manuales del contador sobre un cliente. Merge parcial: mandá
 *  sólo lo que cambió. El backend las re-aplica sobre el dato de ARCA al devolver el cliente. */
export async function editarCliente(cuit: string, campos: CamposEdicion): Promise<void> {
  await apiPut(`/clientes/${cuit.replace(/\D/g, '')}/edicion`, campos);
}

/** Actualiza la clave fiscal con la que se sincroniza el cliente (cuando la cambia en ARCA). Se
 *  guarda cifrada en el backend; apaga el aviso de "debe cambiar la clave" del cliente. */
export async function actualizarClaveFiscal(cuit: string, clave: string): Promise<void> {
  await apiPut(`/clientes/${cuit.replace(/\D/g, '')}/clave`, { clave });
}

/** Activa o desactiva el monitoreo de un cliente. Desactivado: deja de actualizarse su información
 *  y en la lista aparece atenuado como "Desactivado". Los datos ya guardados se conservan. */
export async function cambiarActivoCliente(cuit: string, activo: boolean): Promise<void> {
  await apiPut(`/clientes/${cuit.replace(/\D/g, '')}/activo`, { activo });
}
