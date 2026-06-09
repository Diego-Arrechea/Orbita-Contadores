import type { VentanaRecategorizacion } from '@/types';

/**
 * Genera las ventanas de recategorización del monotributo (vencimiento semestral), derivadas de la
 * fecha actual para que nunca queden vencidas.
 *
 * Desde 2025 ARCA trasladó los vencimientos del 20/01 y 20/07 al **5/02 y 5/08**:
 *  - Semestre Enero-Junio     → vence el 5 de agosto; la nueva categoría rige desde el 1/8.
 *  - Semestre Julio-Diciembre → vence el 5 de febrero (del año siguiente); rige desde el 1/2.
 *
 * Devuelve las próximas DOS ventanas a futuro (incluida la de hoy si justo vence hoy). ARCA puede
 * prorrogar una fecha puntual; en ese caso se ajusta manualmente (ver pantalla de Configuración).
 */
export function ventanasRecategorizacion(desde: Date = new Date()): VentanaRecategorizacion[] {
  const base = desde.getFullYear();
  const candidatas: VentanaRecategorizacion[] = [];
  // Generamos un rango amplio de años (pasado y futuro) y después nos quedamos con las próximas.
  for (let anio = base - 1; anio <= base + 2; anio++) {
    candidatas.push({
      semestre: 'Enero-Junio',
      fechaLimite: `${anio}-08-05`,
      efectoDesde: `${anio}-08-01`,
    });
    candidatas.push({
      semestre: 'Julio-Diciembre',
      fechaLimite: `${anio + 1}-02-05`,
      efectoDesde: `${anio + 1}-02-01`,
    });
  }
  // Comparación lexicográfica de fechas ISO (yyyy-mm-dd): válida y sin líos de zona horaria.
  const hoyISO = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-${String(
    desde.getDate(),
  ).padStart(2, '0')}`;
  return candidatas
    .filter(v => v.fechaLimite >= hoyISO)
    .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))
    .slice(0, 2);
}
