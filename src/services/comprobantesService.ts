import type { Comprobante } from '@/types';
import { apiGet, apiPost } from './apiClient';
import type { JobProgreso } from './onboardingService';

/** Comprobantes emitidos reales de un cliente (vía backend → WSFEv1). */
export function getComprobantesReales(cuit: string): Promise<Comprobante[]> {
  return apiGet<Comprobante[]>(`/clientes/${cuit}/comprobantes`);
}

/** Dispara la sincronización (comprobantes + padrón) en BACKGROUND; devuelve el job_id a poolear. */
export function sincronizarCliente(cuit: string): Promise<{ job_id: string }> {
  return apiPost<{ job_id: string }>(`/clientes/${cuit}/sincronizar`);
}

/** Dispara la sincronización SECUENCIAL de toda la cartera del contador en BACKGROUND. Devuelve el
 * job_id (se poolea con getProgresoSincronizacion, el mismo endpoint) y el total de clientes. */
export function sincronizarTodosClientes(): Promise<{ job_id: string; total: number }> {
  return apiPost<{ job_id: string; total: number }>('/sincronizar-todos');
}

/** Progreso de una sincronización en background (la sigue el SyncContext). */
export function getProgresoSincronizacion(jobId: string): Promise<JobProgreso> {
  return apiGet<JobProgreso>(`/sincronizaciones/${jobId}`);
}
