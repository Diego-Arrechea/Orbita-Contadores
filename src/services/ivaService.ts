/**
 * Apartado de IVA (Libro IVA / posición). Sólo HTTP contra el backend, que además valida el gate
 * (allowlist IVA_EMAILS + admins) en cada endpoint: el front esconde el menú con puedeVerIVA().
 */
import { apiGet, apiGetBlob, apiPatch, BASE_URL } from './apiClient';
import { tokenActual } from '@/lib/cuenta';

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
  retenciones: number;
  otrosPagos: number;
  saldoFavorAnterior: number;
  saldoImpuesto: number;
  aFavor: boolean;
}

/** Ajustes manuales de la posición de un período (los que el contador completa). */
export interface IvaAjuste {
  saldoFavorAnterior: number;
  retenciones: number;
  otrosPagos: number;
}

/** Meses con comprobantes del cliente (para el selector de período). */
export function getPeriodosIva(cuit: string): Promise<IvaPeriodo[]> {
  return apiGet<IvaPeriodo[]>(`/iva/clientes/${cuit}/periodos`);
}

/** Posición de IVA del cliente para un período (débito − crédito = saldo del impuesto). */
export function getPosicionIva(cuit: string, periodo: string): Promise<IvaPosicion> {
  return apiGet<IvaPosicion>(`/iva/clientes/${cuit}/posicion?periodo=${encodeURIComponent(periodo)}`);
}

/** Guarda los ajustes manuales de la posición (saldo a favor anterior, retenciones, otros pagos). */
export function guardarAjustesIva(
  cuit: string,
  periodo: string,
  ajuste: IvaAjuste
): Promise<{ ok: boolean }> {
  return apiPatch(`/iva/clientes/${cuit}/ajustes?periodo=${encodeURIComponent(periodo)}`, ajuste);
}

/** Una revisión sugerida detectada en los comprobantes del período. */
export interface IvaInconsistencia {
  tipo: string; // iva_cero | alicuota_atipica | compra_sin_cuit
  severidad: string; // aviso | datos
  lado: DireccionIva;
  comprobanteId: string;
  comprobante: string;
  contraparte: string;
  detalle: string;
}

/** Revisiones sugeridas del período (posibles errores a chequear antes de declarar). */
export function getInconsistenciasIva(cuit: string, periodo: string): Promise<IvaInconsistencia[]> {
  return apiGet<IvaInconsistencia[]>(
    `/iva/clientes/${cuit}/inconsistencias?periodo=${encodeURIComponent(periodo)}`
  );
}

export interface ImportBorradorResumen {
  actualizados: number;
  sin_match: number;
  total: number;
}

/** Importa el borrador del Libro IVA Digital de AFIP (el ZIP o CSV que se baja del Portal IVA) para
 *  traer la percepción IVA real por comprobante. Se manda el archivo como body crudo (no multipart). */
export async function importarBorradorIva(
  cuit: string,
  archivo: File
): Promise<ImportBorradorResumen> {
  const res = await fetch(`${BASE_URL}/iva/clientes/${cuit}/importar-borrador`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenActual()}`,
      'Content-Type': 'application/octet-stream',
    },
    body: archivo,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
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
