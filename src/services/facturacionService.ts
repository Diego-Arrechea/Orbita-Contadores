import { apiGet, apiGetBlob, apiPost } from './apiClient';

export interface PuntoVenta {
  nro: number;
  emision_tipo: string;
}

export interface ContextoFacturacion {
  tiene_certificado: boolean;
  homologacion: boolean;
  /** Puntos de venta Web Service del cliente. null = todavía no se pudo consultar (sin cert). */
  puntos_venta: PuntoVenta[] | null;
  cert_actualizado_en: string | null;
}

/** Estado de un job en segundo plano (generación del certificado). */
export interface JobProgreso {
  estado: 'en_proceso' | 'terminado' | 'error';
  progreso: number;
  mensaje: string;
  error?: string | null;
}

export interface ComprobanteAsociado {
  tipo: number;
  punto_venta: number;
  numero: number;
}

export interface FacturarPayload {
  cbte_tipo: number; // 11 = Factura C · 13 = Nota de Crédito C
  importe_total: number;
  punto_venta?: number | null; // null/omitido = el backend auto-detecta el PV Web Service
  concepto: number; // 1 productos · 2 servicios · 3 ambos
  doc_tipo: number; // 80 CUIT · 96 DNI · 99 consumidor final
  doc_nro: string;
  condicion_iva_receptor: number; // RG 5616: 5 CF · 1 RI · 4 Exento · 6 Monotributo
  comprobante_asociado?: ComprobanteAsociado | null;
}

export interface ComprobanteEmitidoResp {
  cbte_tipo: number;
  punto_venta: number;
  numero: number;
  fecha: string;
  importe_total: number;
  cae: string;
  cae_vto: string;
  doc_tipo: number;
  doc_nro: string;
  observaciones: string[];
  homologacion: boolean;
}

const soloDigitos = (cuit: string) => cuit.replace(/\D/g, '');

/** Si el cliente ya tiene certificado (emite sin esperar el bootstrap). */
export function getContextoFacturacion(cuit: string): Promise<ContextoFacturacion> {
  return apiGet<ContextoFacturacion>(`/clientes/${soloDigitos(cuit)}/facturacion/contexto`);
}

/** Emite una Factura C / Nota de Crédito C a nombre del cliente. Devuelve el CAE. */
export function facturar(cuit: string, payload: FacturarPayload): Promise<ComprobanteEmitidoResp> {
  return apiPost<ComprobanteEmitidoResp>(`/clientes/${soloDigitos(cuit)}/facturar`, payload);
}

/**
 * Descarga el PDF (representación impresa) de un comprobante emitido y dispara la descarga/apertura
 * en el navegador. Devuelve la URL del blob por si el caller la quiere revocar.
 */
export async function descargarComprobantePdf(
  cuit: string,
  comp: { cbte_tipo: number; punto_venta: number; numero: number },
): Promise<void> {
  const blob = await apiGetBlob(
    `/clientes/${soloDigitos(cuit)}/comprobantes/${comp.cbte_tipo}/${comp.punto_venta}/${comp.numero}/pdf`,
  );
  const url = URL.createObjectURL(blob);
  const nombre = `${comp.cbte_tipo === 13 ? 'NotaCredito_C' : 'Factura_C'}_${String(
    comp.punto_venta,
  ).padStart(5, '0')}-${String(comp.numero).padStart(8, '0')}.pdf`;
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Arranca (en segundo plano) la generación del certificado del cliente. Devuelve el job_id. */
export function prepararFacturacion(cuit: string): Promise<{ job_id: string }> {
  return apiPost<{ job_id: string }>(`/clientes/${soloDigitos(cuit)}/facturacion/preparar`);
}

/** Progreso de la generación del certificado. */
export function progresoPreparacion(cuit: string, jobId: string): Promise<JobProgreso> {
  return apiGet<JobProgreso>(`/clientes/${soloDigitos(cuit)}/facturacion/preparar/${jobId}`);
}

/** ¿El error es el 409 "el cliente no tiene punto de venta Web Service"? */
export function esErrorSinPuntoVenta(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.includes('sin_punto_venta');
}

/**
 * Extrae un mensaje legible del error del backend de facturación. El detalle del 400 puede venir
 * como objeto {mensaje, errores, observaciones} (rechazo de ARCA) o como string; ApiError lo trae
 * embebido en su `message` tras el "API 400 …:".
 */
export function mensajeErrorFacturacion(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const ini = raw.indexOf('{');
  if (ini >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(ini)) as { detail?: unknown };
      const det = parsed.detail;
      if (typeof det === 'string') return det;
      if (det && typeof det === 'object') {
        const d = det as { mensaje?: string; observaciones?: string[]; errores?: string[] };
        return (
          d.mensaje ||
          d.observaciones?.join(' · ') ||
          d.errores?.join(' · ') ||
          raw
        );
      }
    } catch {
      /* no era JSON: caemos al texto crudo */
    }
  }
  return raw;
}
