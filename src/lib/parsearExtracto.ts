/**
 * Parseo REAL de extractos bancarios / exports de billetera (XLSX, XLS, CSV) en el browser, y
 * normalización a filas que el backend cruza con los comprobantes de ARCA.
 *
 * Se parsea acá (no en el backend) para que el paso de "mapeo de columnas" muestre las columnas y
 * el preview REALES del archivo, y para no subir el archivo crudo: sólo viajan las filas mapeadas.
 */
import * as XLSX from 'xlsx';
import type { MovimientoBancario } from '@/types';

export type FuenteMovimiento = MovimientoBancario['fuente']; // 'banco' | 'mercadopago' | 'otro'

/** Campo destino al que se mapea cada columna del archivo (coincide con TARGET_FIELDS del componente). */
export type CampoDestino = 'fecha' | 'descripcion' | 'cuit' | 'monto' | 'saldo' | 'ignorar';

export interface ExtractoParseado {
  columnas: string[];
  filas: string[][]; // filas de datos (sin el encabezado), como strings
  /** Filas crudas previas a la fila de encabezado (título, titular, CUIT, nº de cuenta, etc.). Las
   * usa identificarTitular para deducir de quién es el extracto. Vacío si la tabla arranca arriba. */
  metadatos: string[][];
}

/** Una fila ya normalizada, lista para mandar al backend (shape = MovimientoIn). */
export interface MovimientoNormalizado {
  fecha: string; // ISO aaaa-mm-dd
  monto: number;
  cuitOriginante?: string;
  nombreOriginante?: string;
  descripcion?: string;
}

const MESES_AR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

/** Lee el archivo y devuelve los encabezados + filas crudas de la primera hoja. */
export async function parsearArchivo(file: File): Promise<ExtractoParseado> {
  const buf = await file.arrayBuffer();
  // raw:true y SIN cellDates: no dejamos que SheetJS reinterprete/reformatee las fechas (con
  // cellDates corrompía las de CSV, p. ej. "01/05/2026" → "1/4/26"). Las de CSV quedan como el
  // texto original; las de XLSX quedan como serial de Excel (número) y las resuelve parsearFechaAR.
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) return { columnas: [], filas: [], metadatos: [] };
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: '' });
  const idxHeader = detectarHeader(matriz);
  const columnas = (matriz[idxHeader] ?? []).map((c, i) => String(c ?? '').trim() || `Columna ${i + 1}`);
  const filas = matriz
    .slice(idxHeader + 1)
    .map(row => columnas.map((_, i) => celdaATexto((row as unknown[])[i])))
    .filter(row => row.some(c => c !== ''));
  // Filas de cabecera que detectarHeader salteó: ahí suele estar el titular y su CUIT. Las mapeamos
  // completas (sin recortar a columnas.length) para no perder celdas a la derecha del header.
  const metadatos = matriz
    .slice(0, idxHeader)
    .map(row => (row as unknown[]).map(celdaATexto))
    .filter(row => row.some(c => c !== ''));
  return { columnas, filas, metadatos };
}

/** Convierte una celda cruda a texto sin romper fechas (un Date va a ISO local, no a string localizado). */
function celdaATexto(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).trim();
}

/** Fila de encabezado = la más "densa" (más celdas no vacías) entre las primeras 15. Saltea
 * títulos / metadatos que muchos bancos ponen arriba de la tabla. */
function detectarHeader(matriz: unknown[][]): number {
  let mejor = 0;
  let mejorCount = -1;
  const limite = Math.min(matriz.length, 15);
  for (let i = 0; i < limite; i++) {
    const count = (matriz[i] ?? []).filter(c => String(c ?? '').trim() !== '').length;
    if (count > mejorCount) {
      mejorCount = count;
      mejor = i;
    }
  }
  return mejor;
}

/** Parsea moneda en formato AR ("1.234.567,89", "$ 1.234,50", "(5.000)") a número, o null. */
export function parsearMontoAR(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let signo = 1;
  if (/^\(.*\)$/.test(s)) {
    signo = -1; // (1.234,50) = negativo contable
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,-]/g, ''); // saca $, espacios, "ARS", etc.
  if (s.startsWith('-')) {
    signo = -1;
    s = s.slice(1);
  }
  s = s.replace(/-/g, '');
  if (s === '') return null;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    // El separador que aparece más a la derecha es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, ''); // formato US: 1,234.56
  } else if (tieneComa) {
    s = s.replace(',', '.'); // coma decimal AR
  } else if (tienePunto) {
    // Sólo punto: ambiguo. Si hay >1 punto, o el último grupo tiene 3 dígitos, es separador de miles.
    const partes = s.split('.');
    const ultima = partes[partes.length - 1];
    if (partes.length > 2 || ultima.length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? signo * n : null;
}

/** Parsea fecha de extracto a ISO aaaa-mm-dd (asume día-primero, formato AR), o null. */
export function parsearFechaAR(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const anio4 = (y: number) => (y < 100 ? y + 2000 : y);

  // Serial de Excel (número en rango de fechas plausibles ~1954..2119). 25569 = días entre el
  // epoch de Excel (1899-12-30) y el de Unix (1970-01-01). Redondeamos al día entero (la parte
  // fraccionaria es la hora, un artefacto de TZ) y leemos en UTC para no correr el día.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) {
      const d = new Date((Math.round(n) - 25569) * 86400000);
      if (!Number.isNaN(d.getTime())) return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // ISO
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s); // dd/mm/aaaa (AR)
  if (m) return iso(anio4(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[ -]([a-záéíóú]{3,})[ -](\d{2,4})/i.exec(s); // dd mmm aaaa
  if (m) {
    const mes = MESES_AR[m[2].slice(0, 3).toLowerCase()];
    if (mes) return iso(anio4(+m[3]), mes, +m[1]);
  }
  const d = new Date(s); // último intento
  if (!Number.isNaN(d.getTime())) return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

/** Adivina la fuente por el nombre del archivo (MercadoPago vs banco). */
export function inferirFuente(nombreArchivo: string): FuenteMovimiento {
  const n = nombreArchivo.toLowerCase();
  if (/mercado\s*pago|mercadopago|\bmp\b|wallet|billetera|cuenta\s*digital/.test(n)) return 'mercadopago';
  return 'banco';
}

/** Mapeo inicial editable: asocia cada columna a un campo destino por heurística de nombre. */
export function autoMapear(columnas: string[]): Record<string, CampoDestino> {
  const map: Record<string, CampoDestino> = {};
  let montoAsignado = false;
  for (const col of columnas) {
    const campo = clasificarColumna(col);
    // Sólo la primera columna "monto-like" se mapea a monto; las otras (p. ej. débito) quedan ignoradas.
    if (campo === 'monto') {
      map[col] = montoAsignado ? 'ignorar' : 'monto';
      montoAsignado = true;
    } else {
      map[col] = campo;
    }
  }
  return map;
}

function clasificarColumna(nombre: string): CampoDestino {
  const n = nombre.toLowerCase();
  if (/fecha|date|d[ií]a/.test(n)) return 'fecha';
  if (/cuit|cuil|cbu|cvu|documento|\bdoc\b/.test(n)) return 'cuit';
  if (/saldo|balance/.test(n)) return 'saldo';
  if (/importe|monto|amount|cr[ée]dito|acredita|valor|neto|cobrado|ingreso/.test(n)) return 'monto';
  if (/descrip|detalle|concepto|referencia|movimiento|origen|beneficiario|nombre|titular|contraparte/.test(n))
    return 'descripcion';
  return 'ignorar';
}

/** Aplica el mapeo a las filas crudas y devuelve sólo las filas con fecha y monto válidos. */
export function normalizarFilas(
  filas: string[][],
  columnas: string[],
  mapping: Record<string, CampoDestino>,
): MovimientoNormalizado[] {
  const idxDe = (campo: CampoDestino) => columnas.findIndex(c => mapping[c] === campo);
  const iFecha = idxDe('fecha');
  const iMonto = idxDe('monto');
  const iCuit = idxDe('cuit');
  const iDesc = idxDe('descripcion');

  const out: MovimientoNormalizado[] = [];
  for (const row of filas) {
    const fecha = iFecha >= 0 ? parsearFechaAR(row[iFecha]) : null;
    const monto = iMonto >= 0 ? parsearMontoAR(row[iMonto]) : null;
    if (fecha == null || monto == null) continue; // sin fecha o monto válidos → no es un movimiento
    const cuit = iCuit >= 0 ? row[iCuit].replace(/\D/g, '') : '';
    const desc = iDesc >= 0 ? (row[iDesc] ?? '').trim() : '';
    out.push({
      fecha,
      monto,
      cuitOriginante: cuit || undefined,
      descripcion: desc || undefined,
    });
  }
  return out;
}
