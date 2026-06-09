/**
 * "Alertas vistas": el conjunto de alertas que el contador marcó como vistas desde la campanita.
 * Marcar una alerta como vista la SACA de las notificaciones (campanita) pero NO la elimina del
 * centro de alertas (/alertas), donde sigue figurando (sólo marcada como vista y atenuada).
 *
 * Las alertas se calculan en vivo y tienen id estable (`clienteId-tipo`), así que el "visto"
 * sobrevive al recálculo: si la misma situación persiste, la alerta se regenera con el mismo id y
 * queda vista. Se persiste por cuenta en localStorage y se comparte entre la campanita y la página
 * vía useSyncExternalStore (un único store reactivo, sin context).
 */
import { useSyncExternalStore } from 'react';
import { cuentaActual } from '@/lib/cuenta';

const LS_PREFIX = 'orbita_alertas_vistas';

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

/** Si cambió la cuenta logueada, recarga el set de esa cuenta (evita arrastrar el de otra). */
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

export function marcarVista(id: string): void {
  if (cache.has(id)) return;
  const next = new Set(cache);
  next.add(id);
  guardar(next);
}

export function desmarcarVista(id: string): void {
  if (!cache.has(id)) return;
  const next = new Set(cache);
  next.delete(id);
  guardar(next);
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

export interface AlertasVistas {
  vistas: Set<string>;
  marcarVista: (id: string) => void;
  desmarcarVista: (id: string) => void;
}

export function useAlertasVistas(): AlertasVistas {
  const vistas = useSyncExternalStore(subscribe, getSnapshot);
  return { vistas, marcarVista, desmarcarVista };
}
