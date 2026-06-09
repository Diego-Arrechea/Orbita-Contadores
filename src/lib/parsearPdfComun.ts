/**
 * Base compartida para parsear extractos en PDF de distintos bancos/billeteras. Cada banco tiene su
 * propio módulo (parsearPdfMercadoPago.ts, parsearPdfBancoProvincia.ts) con su parser de TEXTO; acá
 * vive lo común: extracción del texto con pdf.js, tipos, clasificación de categorías y helpers.
 *
 * El parseo es EN EL BROWSER (no se sube el archivo crudo) y está partido en I/O (`extraerTextoPdf`)
 * vs lógica pura (los `parsearTexto…` de cada banco), para poder testear sin navegador.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { MovimientoNormalizado } from './parsearExtracto';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export type BancoPdf = 'mercadopago' | 'banco-provincia' | 'brubank';

export type CategoriaPdf =
  | 'cobro' // ingreso de un tercero → conciliable contra ARCA
  | 'rendimiento' // intereses / rendimientos de la cuenta
  | 'auto-transferencia' // el titular se transfiere a sí mismo
  | 'devolucion'
  | 'inversion' // rescate/colocación de dinero (cuenta remunerada, plazo fijo, etc.)
  | 'cambio' // compra/venta de moneda extranjera
  | 'prestamo'
  | 'egreso'; // salida (monto < 0)

/** Etiqueta legible (para el contador) de cada categoría. */
export const CATEGORIA_LABEL: Record<CategoriaPdf, string> = {
  cobro: 'Cobros a conciliar',
  rendimiento: 'Rendimientos / intereses',
  'auto-transferencia': 'Transferencias propias',
  devolucion: 'Devoluciones',
  inversion: 'Movimientos de inversión',
  cambio: 'Compra/venta de moneda',
  prestamo: 'Préstamos / créditos',
  egreso: 'Gastos / salidas',
};

export interface MovimientoPdf {
  fecha: string; // ISO aaaa-mm-dd
  descripcion: string;
  monto: number; // con signo: + entrada, − salida
  saldo: number | null;
  categoria: CategoriaPdf;
  esConciliable: boolean; // categoria === 'cobro'
}

export interface ExtractoPdf {
  banco: BancoPdf;
  titular: { nombre?: string; cuit?: string; cuenta?: string };
  periodo?: string;
  movimientos: MovimientoPdf[];
}

/** Normaliza para comparar descripciones: minúsculas, sin tildes, espacios colapsados. */
export function normalizarDesc(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Items de texto de pdf.js → líneas. Respeta el ORDEN DE STREAM (que en estos PDF ya es el orden de
 * lectura): no reordena globalmente — sólo corta una línea nueva cuando cambia la coordenada Y, y
 * dentro de cada línea ordena por X. (Reordenar por Y mezcla columnas de filas distintas.)
 */
function itemsALineas(items: Array<{ str?: string; transform?: number[] }>): string[] {
  const piezas = items
    .filter((it): it is { str: string; transform: number[] } => typeof it.str === 'string' && Array.isArray(it.transform))
    .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
  const lineas: string[] = [];
  let buffer: { str: string; x: number }[] = [];
  let yActual: number | null = null;
  const flush = () => {
    if (buffer.length) {
      const txt = buffer.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim();
      if (txt) lineas.push(txt);
    }
    buffer = [];
  };
  for (const p of piezas) {
    if (yActual !== null && Math.abs(p.y - yActual) > 3) flush();
    buffer.push({ str: p.str, x: p.x });
    yActual = p.y;
  }
  flush();
  return lineas;
}

/** Extrae el texto del PDF (en orden de lectura) con pdf.js, una línea por renglón. */
export async function extraerTextoPdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lineas: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    lineas.push(...itemsALineas(content.items as Array<{ str?: string; transform?: number[] }>));
  }
  return lineas.join('\n');
}

/** Mapea los movimientos conciliables al shape que consume el backend (`MovimientoIn`). */
export function aFilasNormalizadas(movimientos: MovimientoPdf[]): MovimientoNormalizado[] {
  return movimientos
    .filter(m => m.esConciliable)
    .map(m => ({ fecha: m.fecha, monto: m.monto, descripcion: m.descripcion }));
}

export interface DesgloseCategoria {
  categoria: CategoriaPdf;
  cantidad: number;
  monto: number; // suma del valor absoluto
}

/** Agrupa los movimientos por categoría (para el desglose del filtrado en la UI). */
export function desglosarPorCategoria(movimientos: MovimientoPdf[]): DesgloseCategoria[] {
  const mapa = new Map<CategoriaPdf, DesgloseCategoria>();
  for (const m of movimientos) {
    const d = mapa.get(m.categoria) ?? { categoria: m.categoria, cantidad: 0, monto: 0 };
    d.cantidad += 1;
    d.monto += Math.abs(m.monto);
    mapa.set(m.categoria, d);
  }
  return [...mapa.values()].sort((a, b) => b.monto - a.monto);
}
