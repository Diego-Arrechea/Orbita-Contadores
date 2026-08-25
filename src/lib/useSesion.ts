/**
 * Re-renderiza el componente cuando cambian los datos de la sesión (los que guarda `lib/cuenta.ts`).
 *
 * La UI lee el usuario de localStorage de forma síncrona, así que un cambio traído por el refresh de
 * sesión —por ejemplo, que el estudio pasó a otro plan y ahora tiene o pierde una sección— no
 * dispara ningún re-render por sí solo. Los componentes que arman el menú o esconden secciones
 * llaman a este hook para enterarse.
 */
import { useSyncExternalStore } from 'react';
import { suscribirSesion, versionSesion } from '@/lib/cuenta';

/** Devuelve un número que cambia en cada actualización de la sesión (sirve como dependencia). */
export function useSesion(): number {
  return useSyncExternalStore(suscribirSesion, versionSesion, versionSesion);
}
