/**
 * Parser del "Estado de cuenta" de Brubank en PDF. Lógica PURA; la invoca el dispatcher
 * parsearPdf.ts con el texto ya extraído por parsearPdfComun.extraerTextoPdf.
 *
 * Particularidades de Brubank (vs. MP / Bapro):
 *   - Cabecera trae CUIT del titular en limpio ("CUIT 20454948301") + el nombre en el bloque de
 *     dirección que se repite en cada página ("Dapoto Conrado Lanfrit"). Asignación automática al
 *     cliente sin tener que inferir el CUIT del cuerpo del extracto.
 *   - Tabla con 6 columnas: Fecha · #Ref (10 dígitos) · Descripción · Débito · Crédito · Saldo.
 *     Exactamente una de débito/crédito viene como "$ X.XXX,YY" y la otra como "-".
 *   - El extracto puede incluir una SEGUNDA caja en USD con prefijo "U$S" — la filtramos: la
 *     conciliación trabaja en pesos y mezclar monedas falsearía los cruces.
 *   - Descripciones de transferencias arrancan con "<CUIT 11d> - <Nombre>" (el originante). Si ese
 *     CUIT es el del titular → auto-transferencia.
 */
import { parsearMontoAR, parsearFechaAR } from './parsearExtracto';
import { normalizarDesc, type CategoriaPdf, type ExtractoPdf, type MovimientoPdf } from './parsearPdfComun';

/** ¿El texto parece un estado de cuenta de Brubank? El nombre del banco aparece en el logo de la
 *  cabecera y en el pie ("Brubank S.A.U."), así que es una marca robusta. */
export function pareceBrubank(texto: string): boolean {
  return /brubank/i.test(texto);
}

/** Clasifica un movimiento de Brubank. `cuitTitular` permite marcar como propias las transferencias
 *  del dueño (su CUIT en la descripción). */
export function clasificarMovimientoBrubank(
  descripcion: string,
  monto: number,
  cuitTitular?: string,
): CategoriaPdf {
  if (monto <= 0) return 'egreso';
  const d = normalizarDesc(descripcion);
  // El "Intereses pagados" son del propio banco (cuenta remunerada): rendimiento, no cobro.
  if (/interes/.test(d)) return 'rendimiento';
  // "Anulación de compra" y "Dev. …" (devolución de IVA, IIBB, ganancias, etc.) → devolución.
  if (/anulacion de compra|^dev\b|devoluc/.test(d)) return 'devolucion';
  // Compra/venta de dólares (la contracara en la caja USD).
  if (/compra de dolar|venta de dolar/.test(d)) return 'cambio';
  // Transferencias entre cuentas propias del titular (MercadoPago, etc.) o donde el CUIT del
  // originante es el del propio titular.
  if (/de una cuenta tuya/.test(d)) return 'auto-transferencia';
  if (cuitTitular && descripcion.includes(cuitTitular)) return 'auto-transferencia';
  return 'cobro';
}

/** Cabecera: titular + CUIT + período. Best-effort — el CUIT es la señal fuerte (asigna cliente). */
function parsearCabecera(lineas: string[]): {
  nombre?: string;
  cuit?: string;
  periodo?: string;
} {
  const cabecera = lineas.slice(0, 30).join(' ');
  // "CUIT 20454948301" — un grupo de 11 dígitos justo después del rótulo.
  const cuit = cabecera.match(/CUIT\s+(\d{11})/i)?.[1];
  // "1 MAY 2026 al 31 MAY 2026" o similar.
  const periodo = cabecera.match(/\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]{3,}\s+\d{4}\s+al\s+\d{1,2}\s+[A-Za-zÁÉÍÓÚáéíóú]{3,}\s+\d{4}/)?.[0];
  // El nombre va en el bloque de dirección (después del rótulo, antes de la calle). Tomamos la
  // primera línea con 2-4 palabras alfabéticas, sin rótulos típicos.
  const ROTULOS = /brubank|cuenta|moneda|cuit|n.mero|cbu|imp\.|saldo|cr.ditos|d.bitos|movimientos|tipo|pesos|d.lar|caja de ahorro|resumen|mi cuenta|fecha|descripci.n|#ref/i;
  const nombre = lineas
    .slice(0, 30)
    .find(l => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,3}$/.test(l) && !ROTULOS.test(l));
  return { nombre, cuit, periodo };
}

// Líneas de cabecera/pie/dirección/USD que se repiten por página y NO son movimientos. La marca
// "U$S" descarta toda la caja en dólares (la conciliación es en pesos).
const LINEA_RUIDO =
  /brubank|^mi cuenta$|^resumen$|^movimientos$|^fecha\b.*saldo$|^tipo\b|^moneda\b|^cuit\b|^n.mero\b|^cbu\b|^imp\.|saldo (inicial|final)|^cr.ditos\b|^d.bitos\b|caja de ahorro|pesos \(ars\)|d.lar \(usd\)|calle\s|^b\d{4}|^la plata$|al\s+\d{1,2}\s+[a-z]{3,}\s+\d{4}|s\.a\.u|c\.u\.i\.t\s+\d|iva inscripto|garant.a|bcra|brubank\.com|r.gimen|dep.sitos en pesos|excluidos|p.gina\s+\d|^\d+\s*\/\s*\d+$|u\$s/i;

// Una fila de movimiento (peso): fecha · ref · descripción · débito · crédito · saldo. Exactamente
// una de débito/crédito viene como "$ X,XX"; la otra como "-". El saldo siempre viene como "$ X,XX"
// (puede ser negativo). La descripción no avanza al primer "$": admite " - " interno (p.ej. "CUIT -
// Nombre"), porque exigimos que las TRES columnas finales matcheen la estructura saldo+pares.
const FILA_RE =
  /(\d{1,2}-\d{1,2}-\d{2,4})\s+(\d{8,})\s+(.+?)\s+(\$\s*-?[\d.,]+|-)\s+(\$\s*-?[\d.,]+|-)\s+\$\s*(-?[\d.,]+)/g;

function parsearMovimientos(lineas: string[], cuitTitular?: string): MovimientoPdf[] {
  const texto = lineas.filter(l => !LINEA_RUIDO.test(l)).join(' ');
  const out: MovimientoPdf[] = [];
  for (const m of texto.matchAll(FILA_RE)) {
    const fecha = parsearFechaAR(m[1]);
    if (fecha == null) continue;
    const debitoTxt = m[4];
    const creditoTxt = m[5];
    // Exactamente UNA columna debe tener monto: si vienen las dos como "-" o las dos como número,
    // es un match espurio (la descripción se "comió" otra fila por el join). Lo descartamos.
    const hayDebito = debitoTxt !== '-';
    const hayCredito = creditoTxt !== '-';
    if (hayDebito === hayCredito) continue;
    const valor = hayCredito ? parsearMontoAR(creditoTxt) : parsearMontoAR(debitoTxt);
    if (valor == null) continue;
    const monto = hayCredito ? valor : -valor; // crédito = entrada (+), débito = salida (−).
    const descripcion = m[3].replace(/\s+/g, ' ').trim();
    const categoria = clasificarMovimientoBrubank(descripcion, monto, cuitTitular);
    out.push({
      fecha,
      descripcion,
      monto,
      saldo: parsearMontoAR(m[6]),
      categoria,
      esConciliable: categoria === 'cobro',
    });
  }
  return out;
}

export function parsearTextoBrubank(texto: string): ExtractoPdf {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const { nombre, cuit, periodo } = parsearCabecera(lineas);
  return {
    banco: 'brubank',
    titular: { nombre, cuit },
    periodo,
    movimientos: parsearMovimientos(lineas, cuit),
  };
}
