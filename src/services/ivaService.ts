/**
 * Apartado de IVA (Libro IVA / posición). Sólo HTTP contra el backend, que además valida el gate
 * (allowlist IVA_EMAILS + admins) en cada endpoint: el front esconde el menú con puedeVerIVA().
 */
import { apiGet, apiGetBlob } from './apiClient';

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

export interface IvaAlicuota {
  alicuota: string; // '21%' | '10.5%' | ...
  neto: number;
  iva: number;
  cantidad: number;
}

export interface IvaLado {
  cantidad: number;
  neto: number;
  iva: number;
  noGravado: number;
  exento: number;
  tributos: number;
  total: number;
  porAlicuota: IvaAlicuota[];
}

export interface IvaPosicion {
  cuit: string;
  periodo: string;
  ventas: IvaLado;
  compras: IvaLado;
  debitoFiscal: number;
  creditoFiscal: number;
  saldoTecnico: number;
  percepciones: number;
  saldoImpuesto: number;
  aFavor: boolean;
}

/** Meses con comprobantes del cliente (para el selector de período). */
export function getPeriodosIva(cuit: string): Promise<IvaPeriodo[]> {
  return apiGet<IvaPeriodo[]>(`/iva/clientes/${cuit}/periodos`);
}

/** Posición de IVA del cliente para un período (débito − crédito = saldo del impuesto). */
export function getPosicionIva(cuit: string, periodo: string): Promise<IvaPosicion> {
  return apiGet<IvaPosicion>(`/iva/clientes/${cuit}/posicion?periodo=${encodeURIComponent(periodo)}`);
}

/** Descarga el Libro IVA Digital de AFIP (ventas o compras) como ZIP (cabecera + alícuotas) y dispara
 *  la descarga en el navegador. Sólo cuentas habilitadas (el backend valida el gate). */
export async function descargarLibroIvaDigital(
  cuit: string,
  periodo: string,
  direccion: DireccionIva
): Promise<void> {
  const blob = await apiGetBlob(
    `/iva/clientes/${cuit}/export/lid?periodo=${encodeURIComponent(periodo)}&direccion=${direccion}`
  );
  const cap = direccion === 'ventas' ? 'Ventas' : 'Compras';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LibroIVADigital_${cap}_${periodo.replace('-', '')}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
