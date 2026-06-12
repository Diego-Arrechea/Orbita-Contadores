/**
 * Días que faltan para que termine la prueba gratis, contados por CALENDARIO (fecha contra fecha a
 * medianoche local), NO por diferencia de timestamp. Así un trial de 30 días muestra 30 el día que
 * arranca y 29 al día siguiente, de forma estable: la hora del día ya no hace rebotar el número
 * entre 29 y 30 (el bug del `Math.ceil` sobre el timestamp completo). 0 si ya venció; null si la
 * cuenta no tiene trial.
 */
export function diasDeTrial(trialFin?: string | null): number | null {
  if (!trialFin) return null;
  const fin = new Date(trialFin);
  if (Number.isNaN(fin.getTime())) return null;
  const finDia = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate());
  const hoy = new Date();
  const hoyDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.max(0, Math.round((finDia.getTime() - hoyDia.getTime()) / 86400000));
}
