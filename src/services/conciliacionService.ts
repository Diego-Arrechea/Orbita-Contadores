/**
 * Orquesta la conciliación CENTRAL (carga masiva de extractos, pantalla pages/Conciliacion.tsx).
 * No reimplementa el cruce: reutiliza el endpoint por-cliente (movimientosService → backend
 * services/conciliacion.py), que ya importa las acreditaciones y las matchea transacción por
 * transacción contra los comprobantes reales de ARCA. Acá sólo coordinamos varios clientes a la vez.
 */
import type { MovimientoBancario } from '@/types';
import type { FuenteMovimiento, MovimientoNormalizado } from '@/lib/parsearExtracto';
import { importarMovimientos, getMovimientos, type ImportarResumen } from './movimientosService';

/** Un extracto ya parseado y ASIGNADO a su cliente, listo para importar. */
export interface AsignacionExtracto {
  /** Id local del extracto en la UI, para mapear el resultado de vuelta a su fila. */
  extractoId: string;
  clienteCuit: string;
  fuente: FuenteMovimiento;
  filas: MovimientoNormalizado[];
}

export interface ResultadoExtracto {
  extractoId: string;
  clienteCuit: string;
  ok: boolean;
  resumen?: ImportarResumen;
  error?: string;
}

/**
 * Importa + cruza con ARCA cada extracto ya asignado. Secuencial a propósito (no golpear el backend
 * en paralelo); cada extracto reporta su propio resultado, así un fallo aislado no corta el lote.
 */
export async function procesarExtractos(
  asignaciones: AsignacionExtracto[],
): Promise<ResultadoExtracto[]> {
  const out: ResultadoExtracto[] = [];
  for (const a of asignaciones) {
    try {
      const resumen = await importarMovimientos(a.clienteCuit, a.fuente, a.filas);
      out.push({ extractoId: a.extractoId, clienteCuit: a.clienteCuit, ok: true, resumen });
    } catch (e) {
      out.push({
        extractoId: a.extractoId,
        clienteCuit: a.clienteCuit,
        ok: false,
        error: e instanceof Error ? e.message : 'No se pudo procesar el extracto.',
      });
    }
  }
  return out;
}

/** Movimientos de un grupo de clientes (para el panel consolidado). Un cliente que falle devuelve
 * lista vacía y no tumba al resto. */
export async function getMovimientosDeCartera(
  cuits: string[],
): Promise<{ cuit: string; movimientos: MovimientoBancario[] }[]> {
  const unicos = [...new Set(cuits)];
  return Promise.all(
    unicos.map(async cuit => {
      try {
        return { cuit, movimientos: await getMovimientos(cuit) };
      } catch {
        return { cuit, movimientos: [] as MovimientoBancario[] };
      }
    }),
  );
}
