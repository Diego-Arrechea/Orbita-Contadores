import type { MovimientoBancario } from '@/types';
import type { FuenteMovimiento, MovimientoNormalizado } from '@/lib/parsearExtracto';
import { apiGet, apiPost, apiDelete } from './apiClient';

/** Resumen que devuelve el backend al importar un extracto. */
export interface ImportarResumen {
  importados: number;
  duplicadosOmitidos: number;
  debitosOmitidos: number;
  matcheadosAuto: number;
  pendientes: number;
  movimientos: MovimientoBancario[];
}

const soloDigitos = (cuit: string) => cuit.replace(/\D/g, '');

/** Sube las filas normalizadas de un extracto y las cruza con los comprobantes reales del cliente. */
export function importarMovimientos(
  cuit: string,
  fuente: FuenteMovimiento,
  filas: MovimientoNormalizado[],
): Promise<ImportarResumen> {
  return apiPost<ImportarResumen>(`/clientes/${soloDigitos(cuit)}/movimientos/importar`, { fuente, filas });
}

/** Movimientos ya persistidos del cliente (más reciente primero). */
export function getMovimientos(cuit: string): Promise<MovimientoBancario[]> {
  return apiGet<MovimientoBancario[]>(`/clientes/${soloDigitos(cuit)}/movimientos`);
}

/** Decisión manual del contador sobre un movimiento: venta/no-venta o match forzado. */
export function clasificarMovimiento(
  cuit: string,
  id: string,
  payload: { marcadoComo?: 'ingreso-actividad' | 'no-es-venta'; comprobanteId?: string },
): Promise<MovimientoBancario> {
  return apiPost<MovimientoBancario>(`/clientes/${soloDigitos(cuit)}/movimientos/${id}/clasificar`, payload);
}

/** Re-corre el matcher sobre los pendientes (tras sincronizar comprobantes nuevos). */
export function reconciliarPendientes(cuit: string): Promise<{ reconciliados: number }> {
  return apiPost<{ reconciliados: number }>(`/clientes/${soloDigitos(cuit)}/movimientos/reconciliar`);
}

/** Borra una fila mal importada. */
export function eliminarMovimiento(cuit: string, id: string): Promise<{ eliminado: number }> {
  return apiDelete<{ eliminado: number }>(`/clientes/${soloDigitos(cuit)}/movimientos/${id}`);
}
