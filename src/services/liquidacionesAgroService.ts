import { apiGet } from './apiClient';

/** Una Liquidación Electrónica del sector primario (agro) del cliente. */
export interface LiquidacionAgro {
  /** id de la liquidación (clave estable). */
  id: string;
  /** 'receptor' (le compran al cliente) o 'emisor'. */
  direccion: string;
  /** Descripción legible del tipo (p.ej. "Liquidación Compra Directa"). */
  tipo: string;
  cbteTipo: number;
  puntoVenta: number;
  numero: string;
  /** Fecha del comprobante (ISO aaaa-mm-dd) o null. */
  fechaComprobante: string | null;
  /** CUIT de la contraparte (el emisor de la liquidación, o el receptor si direccion=emisor). */
  contraparteCuit: string;
  sistema: string;
  /** Venta bruta (en pesos). */
  importeBruto: number;
}

export interface LiquidacionesAgro {
  /** El cliente está marcado como agropecuario. */
  facturaAgro: boolean;
  /** Suma de `importeBruto` de todas las liquidaciones. */
  totalBruto: number;
  liquidaciones: LiquidacionAgro[];
}

/** Facturación agropecuaria del cliente (liquidaciones + total). Vacío si no le aplica. */
export function getLiquidacionesAgro(cuit: string): Promise<LiquidacionesAgro> {
  return apiGet<LiquidacionesAgro>(`/clientes/${cuit}/liquidaciones-agro`);
}
