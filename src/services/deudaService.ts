import { apiGet, apiPost } from './apiClient';

export interface DeudaMovimiento {
  periodo: string;
  impuesto: string;
  concepto: string;
  descripcion: string;
  vencimiento: string;
  debe: number;
  haber: number;
}

export interface DeudaPeriodo {
  periodo: string;
  debe: number;
  haber: number;
  saldo: number;
}

/** Saldo por período de la Consulta de Saldos (P05), el estado YA RESUELTO por ARCA. Más fiable que
 *  `por_periodo`/`movimientos` (el ledger de P04 viene flaky). `saldo` negativo = deuda. */
export interface DeudaSaldoPeriodo {
  periodo: string;
  saldo: number | null;
  tipo: string; // MONOTRIBUTO | AUTONOMO
  estado: 'DEUDOR' | 'SALDADO' | 'ACREEDOR';
}

/**
 * Lo que quedó guardado del último cálculo de deuda. Puede ser:
 *  - el detalle real (deudor/capital/intereses/movimientos), o
 *  - un marcador `{ no_aplica: true, motivo }` cuando el cliente no tiene cuenta corriente
 *    (se persiste para no volver a preguntar en cada recarga).
 */
export interface DeudaDetalle {
  fecha_calculo?: string | null;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  deudor?: number | null; // Total Saldo Deudor = capital + intereses
  acreedor?: number | null; // Total Saldo Acreedor (saldo a favor)
  capital?: number | null; // Obligación Mensual impaga
  intereses?: number | null; // Accesorios (intereses resarcitorios)
  movimientos?: DeudaMovimiento[];
  por_periodo?: DeudaPeriodo[];
  saldos_periodo?: DeudaSaldoPeriodo[]; // Consulta de Saldos (P05): estado por período, fiable
  no_aplica?: boolean; // marcador: el cliente no tiene cuenta corriente
  motivo?: string | null;
}

interface DeudaResp {
  deuda_detalle: DeudaDetalle | null;
  ok?: boolean;
}

const cuitDigits = (cuit: string) => cuit.replace(/\D/g, '');

/** Lo guardado del último cálculo (detalle o marcador `no_aplica`). null si nunca se consultó. */
export async function getDeuda(cuit: string): Promise<DeudaDetalle | null> {
  const r = await apiGet<DeudaResp>(`/clientes/${cuitDigits(cuit)}/deuda`);
  return r.deuda_detalle;
}

/**
 * Consulta la CCMA EN VIVO y devuelve lo que quedó guardado (detalle o marcador `no_aplica`).
 * `ok=false` = la consulta no dio resultado (fallo transitorio) → conviene reintentar.
 */
export async function sincronizarDeuda(
  cuit: string,
): Promise<{ detalle: DeudaDetalle | null; ok: boolean }> {
  const r = await apiPost<DeudaResp>(`/clientes/${cuitDigits(cuit)}/deuda`, {});
  return { detalle: r.deuda_detalle, ok: !!r.ok };
}
