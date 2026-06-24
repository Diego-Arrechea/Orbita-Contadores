/**
 * "Novedades vistas": las entradas del changelog que el contador ya vio. Se usa para mostrar el
 * puntito de "hay novedades" en el header y resaltar las nuevas en /novedades. Se persiste por
 * cuenta en localStorage y se comparte entre el indicador y la página vía useSyncExternalStore
 * (mismo patrón que alertasVistas).
 *
 * Guardamos el conjunto de `id` ya vistos: una novedad es "no vista" si su id no está en el set.
 * Como los ids son estables, el "visto" sobrevive a nuevos deploys (sólo las entradas nuevas
 * aparecen como no vistas).
 */
import { useSyncExternalStore } from 'react';
import { cuentaActual } from '@/lib/cuenta';
import { NOVEDADES } from '@/data/novedades';

const LS_PREFIX = 'orbita_novedades_vistas';

function claveLS(): string {
  const email = cuentaActual()?.email ?? 'anon';
  return `${LS_PREFIX}:${email}`;
}

function leer(): Set<string> {
  try {
    const raw = localStorage.getItem(claveLS());
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

let claveActual = claveLS();
let cache = leer();
const listeners = new Set<() => void>();

function sincronizarClave(): void {
  const k = claveLS();
  if (k !== claveActual) {
    claveActual = k;
    cache = leer();
  }
}

function guardar(next: Set<string>): void {
  cache = next;
  try {
    localStorage.setItem(claveActual, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
  listeners.forEach(l => l());
}

/** Marca todas las novedades actuales como vistas (limpia el puntito del header). */
export function marcarTodasVistas(): void {
  const ids = NOVEDADES.map(n => n.id);
  if (ids.every(id => cache.has(id))) return;
  guardar(new Set([...cache, ...ids]));
}

function subscribe(cb: () => void): () => void {
  sincronizarClave();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Set<string> {
  return cache;
}

export interface NovedadesVistas {
  vistas: Set<string>;
  /** Cantidad de novedades que el contador todavía no vio. */
  noVistas: number;
  marcarTodasVistas: () => void;
}

export function useNovedadesVistas(): NovedadesVistas {
  const vistas = useSyncExternalStore(subscribe, getSnapshot);
  const noVistas = NOVEDADES.reduce((n, nov) => (vistas.has(nov.id) ? n : n + 1), 0);
  return { vistas, noVistas, marcarTodasVistas };
}
