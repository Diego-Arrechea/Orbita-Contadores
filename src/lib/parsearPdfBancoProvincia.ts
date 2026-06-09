/**
 * Parser del "Detalle de Movimientos" de Banco Provincia (Bapro) en PDF. Lógica PURA; la invoca el
 * dispatcher parsearPdf.ts con el texto ya extraído.
 *
 * Particularidades de Bapro (vs. MercadoPago):
 *   - NO trae el titular ni su CUIT en la cabecera (sólo el N° de cuenta). El CUIT del titular se
 *     INFIERE como el de 11 dígitos más repetido del documento (aparece en sus auto-transferencias
 *     "TRANSF DE … (CUIT)" y en los DEBIN "C:CUIT").
 *   - Montos en formato US (1,234.56) y fechas "dd-mmm-aaaa" (mes abreviado en español).
 *   - Ruido típico a descartar: transferencias propias, intereses y compra/venta de moneda extranjera.
 */
import { parsearMontoAR, parsearFechaAR } from './parsearExtracto';
import { normalizarDesc, type CategoriaPdf, type ExtractoPdf, type MovimientoPdf } from './parsearPdfComun';

/** ¿El texto parece un detalle de movimientos de Banco Provincia? (marcadores propios de Bapro). */
export function pareceBancoProvincia(texto: string): boolean {
  return /db\.debin|sistemas del banco|detalle de movimientos\s*cuenta/i.test(texto);
}

/** CUIT del titular = el de 11 dígitos que más se repite en el documento (sus propias operaciones).
 * Requiere al menos 2 apariciones para no confundirlo con la contraparte de un único movimiento. */
function inferirCuitTitular(texto: string): string | undefined {
  const conteo = new Map<string, number>();
  for (const m of texto.matchAll(/\b(\d{11})\b/g)) {
    conteo.set(m[1], (conteo.get(m[1]) ?? 0) + 1);
  }
  let mejor: string | undefined;
  let max = 0;
  for (const [cuit, n] of conteo) {
    if (n > max) {
      max = n;
      mejor = cuit;
    }
  }
  return max >= 2 ? mejor : undefined;
}

/** Clasifica un movimiento. `cuitTitular` permite marcar como propias las transferencias del dueño. */
export function clasificarMovimientoBP(
  descripcion: string,
  monto: number,
  cuitTitular?: string,
): CategoriaPdf {
  if (monto <= 0) return 'egreso';
  const d = normalizarDesc(descripcion);
  if (/interes/.test(d)) return 'rendimiento';
  if (/devoluc/.test(d)) return 'devolucion';
  if (/moneda extranjera|venta de moneda|compra de moneda|venta de dolar|compra de dolar/.test(d)) return 'cambio';
  // Transferencia/movimiento donde el originante es el propio titular (su CUIT en la descripción).
  if (cuitTitular && descripcion.includes(cuitTitular)) return 'auto-transferencia';
  return 'cobro';
}

// Líneas de cabecera/pie que se repiten por página y NO son movimientos.
const LINEA_RUIDO =
  /^fecha:\s|^fecha\s+descripci.n|detalle de movimientos|sistemas del banco|supeditada a los ajustes|p.gina\s+\d+\s+de|^\d+$/i;

// Una fila: fecha "dd-mmm-aaaa" · (descripción) · importe · saldo (ambos en formato US 1,234.56).
const FILA_RE =
  /(\d{1,2}-[a-záéíóú]{3,}-\d{4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})/g;

function parsearMovimientos(lineas: string[], cuitTitular?: string): MovimientoPdf[] {
  const texto = lineas.filter(l => !LINEA_RUIDO.test(l)).join(' ');
  const out: MovimientoPdf[] = [];
  for (const m of texto.matchAll(FILA_RE)) {
    const fecha = parsearFechaAR(m[1]);
    const monto = parsearMontoAR(m[3]);
    if (fecha == null || monto == null) continue;
    const descripcion = m[2].replace(/\s+/g, ' ').trim();
    const categoria = clasificarMovimientoBP(descripcion, monto, cuitTitular);
    out.push({
      fecha,
      descripcion,
      monto,
      saldo: parsearMontoAR(m[4]),
      categoria,
      esConciliable: categoria === 'cobro',
    });
  }
  return out;
}

export function parsearTextoBancoProvincia(texto: string): ExtractoPdf {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const cuitTitular = inferirCuitTitular(texto);
  const cuenta = texto.match(/cuenta:\s*([\d-]+\/\d)/i)?.[1];
  return {
    banco: 'banco-provincia',
    titular: { cuit: cuitTitular, cuenta },
    movimientos: parsearMovimientos(lineas, cuitTitular),
  };
}
