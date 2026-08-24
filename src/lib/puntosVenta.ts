/**
 * Puntos de venta del cliente: cómo se muestran (número + nombre) en toda la app.
 *
 * El número solo ("00002") no le dice nada al contador cuando el cliente factura desde varios
 * lugares. El nombre sale de dos fuentes, en este orden: el que el contador le puso a mano y, si no
 * puso ninguno, el que el cliente tiene registrado. Cuando no hay ninguno de los dos queda el
 * número, y como referencia el sistema con el que emite ese punto.
 */
import type { Cliente, PuntoVentaCliente } from '@/types';

/** Número del punto de venta con el formato de siempre, a 5 dígitos: 2 → "00002". */
export function formatPuntoVenta(nro: number) {
  return nro.toString().padStart(5, '0');
}

/** Índice nro → punto de venta, para resolver el nombre donde se necesite. */
export function indicePuntosVenta(cliente: Cliente): Map<number, PuntoVentaCliente> {
  return new Map((cliente.puntosVenta ?? []).map(p => [p.nro, p]));
}

/** "00002 · Local Centro", o sólo "00002" si el punto todavía no tiene nombre. */
export function etiquetaPuntoVenta(nro: number, pv?: PuntoVentaCliente) {
  const numero = formatPuntoVenta(nro);
  return pv?.nombre ? `${numero} · ${pv.nombre}` : numero;
}

/**
 * Versión corta del sistema con el que emite un punto de venta, para distinguir dos puntos que se
 * llaman igual (pasa seguido: el mismo negocio con un punto por sistema o por régimen).
 *
 * "Factuweb (Imprenta) - Responsable Inscripto" → "Imprenta · RI"
 * "Factura Electronica - Monotributo - Web Services" → "Web Services · Monotributo"
 */
export function sistemaCorto(sistema?: string): string | undefined {
  if (!sistema) return undefined;
  const s = sistema.toLowerCase();
  const familia = s.includes('caea')
    ? 'Contingencia (CAEA)'
    : s.includes('remito')
      ? 'Remito electrónico'
      : s.includes('imprenta') || s.includes('factuweb')
        ? 'Imprenta'
        : s.includes('web service') || s.includes('rece')
          ? 'Web Services'
          : s.includes('controlador')
            ? 'Controlador fiscal'
            : s.includes('linea') || s.includes('línea')
              ? 'Factura en Línea'
              : sistema;
  if (familia === sistema) return sistema; // sistema que no conocemos: lo dejamos como viene
  const regimen = s.includes('monotributo')
    ? 'Monotributo'
    : s.includes('responsable inscripto') || s.includes('ri iva')
      ? 'RI'
      : undefined;
  return regimen ? `${familia} · ${regimen}` : familia;
}
