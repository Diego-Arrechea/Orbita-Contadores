/**
 * Parser del "Resumen de cuenta" de MercadoPago en PDF. Lógica PURA (recibe el texto ya extraído por
 * parsearPdfComun.extraerTextoPdf); la invoca el dispatcher parsearPdf.ts. Lee titular+CUIT de la
 * cabecera (→ asignación automática del cliente) y clasifica cada fila para quedarse sólo con los
 * COBROS de terceros (conciliables), descartando rendimientos, transferencias del propio titular,
 * devoluciones, rescates de inversión y préstamos.
 */
import { parsearMontoAR, parsearFechaAR } from './parsearExtracto';
import { tokens } from './identificarTitular';
import { normalizarDesc, type CategoriaPdf, type ExtractoPdf, type MovimientoPdf } from './parsearPdfComun';

/** ¿El texto parece un resumen de MercadoPago? */
export function pareceMercadoPago(texto: string): boolean {
  return /mercado\s*pago|mercado libre|cvu[:\s]/i.test(texto);
}

/** Clasifica un movimiento por su descripción y signo. El titular sirve para detectar las
 * transferencias que el dueño de la cuenta se hace a sí mismo (no son ventas). */
export function clasificarMovimientoMP(
  descripcion: string,
  monto: number,
  titularNombre?: string,
): CategoriaPdf {
  if (monto <= 0) return 'egreso';
  const d = normalizarDesc(descripcion);
  if (/rendimiento/.test(d)) return 'rendimiento';
  if (/devolucion/.test(d)) return 'devolucion';
  if (/dinero retirado|dinero reservado/.test(d)) return 'inversion';
  if (/dinero plus|credito.*mercado pago|acreditacion de dinero/.test(d)) return 'prestamo';
  // Transferencia recibida cuyo originante es el propio titular → plata que se mueve entre sus cuentas.
  if (/transferencia recibida/.test(d) && titularNombre) {
    const tsTitular = tokens(titularNombre);
    if (tsTitular.length >= 2) {
      const presentes = new Set(tokens(descripcion));
      if (tsTitular.every(t => presentes.has(t))) return 'auto-transferencia';
    }
  }
  return 'cobro';
}

/** Encabezado: titular, CUIT, CVU y período. Best-effort — el CUIT es la señal fuerte. */
function parsearCabecera(lineas: string[]): {
  nombre?: string;
  cuit?: string;
  cuenta?: string;
  periodo?: string;
} {
  const cabecera = lineas.slice(0, 15).join(' ');
  // CUIT = primer grupo de EXACTAMENTE 11 dígitos en la cabecera (el CVU tiene 22, no matchea).
  const cuit = cabecera.match(/\b(\d{11})\b/)?.[1];
  const cvu = cabecera.match(/CVU[:\s]*(\d{20,22})/i)?.[1];
  const periodo = cabecera.match(/Del\s+.+?\s+de\s+\d{4}/i)?.[0];
  const ROTULOS = /resumen|cuenta|pesos|cvu|cuit|cuil|periodo|saldo|detalle|entradas|salidas|movimiento/i;
  const nombre = lineas
    .slice(0, 8)
    .find(l => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,3}$/.test(l) && !ROTULOS.test(l));
  return { nombre, cuit, cuenta: cvu, periodo };
}

// Líneas de cabecera/pie que se repiten por página y NO son movimientos.
const LINEA_RUIDO =
  /^\d+\/\d+$|^(fecha|descripci.n|id de la|operaci.n|valor|saldo)$|^fecha\b.*saldo$|mercado libre s\.?r\.?l\.?|www\.mercadopago|fecha de generaci.n|detalle de movimientos|resumen de cuenta/i;

// Una fila de movimiento: fecha · (descripción) · idOperación (≥8 díg) · $ valor · $ saldo.
const FILA_RE =
  /(\d{2}-\d{2}-\d{4})\s+(.+?)\s+(\d{8,})\s+\$\s*(-?[\d.]+,\d{2})\s+\$\s*(-?[\d.]+,\d{2})/g;

function parsearMovimientos(lineas: string[], titularNombre?: string): MovimientoPdf[] {
  const texto = lineas.filter(l => !LINEA_RUIDO.test(l)).join(' ');
  const out: MovimientoPdf[] = [];
  for (const m of texto.matchAll(FILA_RE)) {
    const fecha = parsearFechaAR(m[1]);
    const monto = parsearMontoAR(m[4]);
    if (fecha == null || monto == null) continue;
    const descripcion = m[2].replace(/\s+/g, ' ').trim();
    const categoria = clasificarMovimientoMP(descripcion, monto, titularNombre);
    out.push({
      fecha,
      descripcion,
      monto,
      saldo: parsearMontoAR(m[5]),
      categoria,
      esConciliable: categoria === 'cobro',
    });
  }
  return out;
}

export function parsearTextoMercadoPago(texto: string): ExtractoPdf {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const { nombre, cuit, cuenta, periodo } = parsearCabecera(lineas);
  return {
    banco: 'mercadopago',
    titular: { nombre, cuit, cuenta },
    periodo,
    movimientos: parsearMovimientos(lineas, nombre),
  };
}
