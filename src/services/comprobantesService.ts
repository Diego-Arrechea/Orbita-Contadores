import type { Comprobante } from '@/types';
import { apiGet, apiPost, apiDelete } from './apiClient';

/** Comprobantes emitidos reales de un cliente (vía backend → WSFEv1). */
export function getComprobantesReales(cuit: string): Promise<Comprobante[]> {
  return apiGet<Comprobante[]>(`/clientes/${cuit}/comprobantes`);
}

/** Datos que el contador carga a mano para un comprobante que no figura en Mis Comprobantes. */
export interface ComprobanteManualPayload {
  direccion: 'emitido' | 'recibido';
  cbte_tipo: number;
  fecha: string;            // 'YYYY-MM-DD'
  punto_venta: number;
  numero: number;
  numero_hasta?: number | null; // último número de un rango ("múltiple"); null = uno solo
  importe_total: number;    // en pesos
  contraparte_nombre: string;
  contraparte_cuit: string;
  // Desglose de IVA (Libro IVA de un RI). Sin `alicuotas` queda sólo el total, como neto.
  alicuotas?: { alicuota: number; base: number }[];
  imp_no_gravado?: number;
  imp_exento?: number;
}

/** Alta manual de un comprobante (venta o compra) que no está en Mis Comprobantes. */
export function crearComprobanteManual(
  cuit: string,
  payload: ComprobanteManualPayload,
): Promise<Comprobante> {
  return apiPost<Comprobante>(`/clientes/${cuit}/comprobantes/manual`, payload);
}

/** Borra un comprobante cargado a mano (sólo los de origen 'manual'). */
export function eliminarComprobanteManual(
  cuit: string,
  c: Pick<Comprobante, 'direccion' | 'puntoVenta' | 'cbteTipo' | 'numero'>,
): Promise<{ ok: boolean }> {
  const path = `/clientes/${cuit}/comprobantes/manual/${c.direccion}/${c.puntoVenta}/${c.cbteTipo}/${Number(c.numero)}`;
  return apiDelete<{ ok: boolean }>(path);
}
