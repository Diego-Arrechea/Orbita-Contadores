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
