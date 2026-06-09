import type { Cliente, Regimen } from '@/types';

/**
 * ¿El cliente es monotributista? Sólo entonces aplica el seguimiento de monotributo (categoría,
 * topes, recategorización, cuota).
 *
 * OJO con el default: los clientes de ejemplo (mock) NO setean `regimen` (queda undefined) y se
 * tratan como monotributistas para no romper el demo. Por eso el "no monotributista" tiene que ser
 * EXPLÍCITO ('responsable_inscripto' o 'no_monotributo'); nunca se asume por ausencia de dato.
 */
export function esMonotributista(cliente: Pick<Cliente, 'regimen'>): boolean {
  return cliente.regimen == null || cliente.regimen === 'monotributo';
}

/** Etiqueta legible del régimen (encabezados, reportes). */
export function etiquetaRegimen(regimen?: Regimen): string {
  if (regimen === 'responsable_inscripto') return 'Responsable Inscripto';
  if (regimen === 'no_monotributo') return 'No monotributista';
  return 'Monotributo';
}

/** Etiqueta corta para badges en tablas. */
export function etiquetaRegimenCorta(regimen?: Regimen): string {
  if (regimen === 'responsable_inscripto') return 'RI';
  if (regimen === 'no_monotributo') return 'No MT';
  return 'MT';
}
