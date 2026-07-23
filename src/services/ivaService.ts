/**
 * Apartado de IVA (Libro IVA / posición). Sólo HTTP contra el backend, que además valida el gate
 * (allowlist IVA_EMAILS + admins) en cada endpoint: el front esconde el menú con puedeVerIVA().
 */
import { apiGet } from './apiClient';

export interface IvaPeriodo {
  periodo: string; // aaaa-mm
  label: string; // 'Julio 2026'
  ventas: number; // cantidad de comprobantes emitidos
  compras: number; // cantidad de comprobantes recibidos
}

export type DireccionIva = 'ventas' | 'compras';

export interface IvaLinea {
  id: string;
  fecha: string; // ISO aaaa-mm-dd
  tipo: string; // 'Factura A', 'Nota Crédito B', ...
  cbteTipo: number;
  puntoVenta: number;
  numero: string;
  contraparteNombre: string;
  contraparteCuit: string;
  neto: number;
  iva: number;
  noGravado: number;
  exento: number;
  tributos: number;
  total: number;
  esNotaCredito: boolean;
  /** true = el comprobante todavía no tiene el desglose de IVA capturado (se muestra el total como
   *  neto). Se completa a medida que el sync captura el neto/IVA discriminado. */
  sinDesglose: boolean;
}

export interface IvaSubtotales {
  cantidad: number;
  neto: number;
  iva: number;
  noGravado: number;
  exento: number;
  tributos: number;
  total: number;
}

export interface IvaLibro {
  cuit: string;
  periodo: string;
  direccion: DireccionIva;
  lineas: IvaLinea[];
  subtotales: IvaSubtotales;
}

/** Meses con comprobantes del cliente (para el selector de período). */
export function getPeriodosIva(cuit: string): Promise<IvaPeriodo[]> {
  return apiGet<IvaPeriodo[]>(`/iva/clientes/${cuit}/periodos`);
}

/** Libro IVA del cliente para un período y dirección (ventas = emitidos, compras = recibidos). */
export function getLibroIva(
  cuit: string,
  periodo: string,
  direccion: DireccionIva
): Promise<IvaLibro> {
  return apiGet<IvaLibro>(
    `/iva/clientes/${cuit}/libro?periodo=${encodeURIComponent(periodo)}&direccion=${direccion}`
  );
}
