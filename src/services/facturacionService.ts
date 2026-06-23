import { apiGet, apiPost } from './apiClient';

export interface ContextoFacturacion {
  tiene_certificado: boolean;
  homologacion: boolean;
  cert_actualizado_en: string | null;
}

export interface ComprobanteAsociado {
  tipo: number;
  punto_venta: number;
  numero: number;
}

export interface FacturarPayload {
  cbte_tipo: number; // 11 = Factura C · 13 = Nota de Crédito C
  importe_total: number;
  punto_venta: number;
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
