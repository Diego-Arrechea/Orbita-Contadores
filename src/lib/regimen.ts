import type { Cliente, Regimen } from '@/types';

/**
 * ¿El cliente es monotributista? Sólo entonces aplica el seguimiento de monotributo (categoría,
 * topes, recategorización, cuota).
 *
 * OJO con el default: los clientes de ejemplo (mock) NO setean `regimen` (queda undefined) y se
 * tratan como monotributistas para no romper el demo. Por eso el "no monotributista" tiene que ser
 * EXPLÍCITO ('responsable_inscripto' o 'no_monotributo'); nunca se asume por ausencia de dato.
 *
 * 'pendiente' (todavía no tenemos el dato) NO es monotributista acá: no queremos inventarle categoría
 * ni gauge. La ficha lo distingue del "no monotributista" de verdad con un cartel propio (ver
 * `regimenPendiente` y SituacionActual).
 */
export function esMonotributista(cliente: Pick<Cliente, 'regimen'>): boolean {
  return cliente.regimen == null || cliente.regimen === 'monotributo';
}

/** ¿Todavía no tenemos el dato del régimen de este cliente? (alta que no llegó a traerlo). */
export function regimenPendiente(cliente: Pick<Cliente, 'regimen'>): boolean {
  return cliente.regimen === 'pendiente';
}

/** Etiqueta legible del régimen (encabezados, reportes). */
export function etiquetaRegimen(regimen?: Regimen): string {
  if (regimen === 'responsable_inscripto') return 'Responsable Inscripto';
  if (regimen === 'no_monotributo') return 'No monotributista';
  if (regimen === 'pendiente') return 'Datos en proceso';
  return 'Monotributo';
}

/** Etiqueta corta para badges en tablas. */
export function etiquetaRegimenCorta(regimen?: Regimen): string {
  if (regimen === 'responsable_inscripto') return 'RI';
  if (regimen === 'no_monotributo') return 'No MT';
  if (regimen === 'pendiente') return 'En proceso';
  return 'MT';
}
