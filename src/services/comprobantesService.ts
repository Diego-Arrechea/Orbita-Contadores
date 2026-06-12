import type { Comprobante } from '@/types';
import { apiGet } from './apiClient';

/** Comprobantes emitidos reales de un cliente (vía backend → WSFEv1). */
export function getComprobantesReales(cuit: string): Promise<Comprobante[]> {
  return apiGet<Comprobante[]>(`/clientes/${cuit}/comprobantes`);
}
