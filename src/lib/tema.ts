import { useSyncExternalStore } from 'react';

/**
 * Tema visual (claro / oscuro). La preferencia vive en el navegador de cada persona (localStorage),
 * no en la cuenta: es una cuestión del dispositivo y de la hora del día, no del estudio.
 *
 * El modo oscuro se activa con la clase `dark` en <html> (tokens en `index.css`). Para que no haya
 * un destello claro al abrir la app, `index.html` aplica la clase con un script mínimo ANTES de que
 * cargue React; acá se mantiene después (cambios de preferencia, del tema del sistema, otra pestaña).
 */

export type PreferenciaTema = 'claro' | 'oscuro' | 'sistema';
export type TemaEfectivo = 'claro' | 'oscuro';

export const LS_TEMA = 'orbita_tema';
/** Mientras nadie elija, la app queda como siempre: en claro (no se cambia sola por el sistema). */
const PREFERENCIA_INICIAL: PreferenciaTema = 'claro';
const MEDIA_OSCURO = '(prefers-color-scheme: dark)';
const COLOR_BARRA = { claro: '#2f6bff', oscuro: '#0a1120' } as const;

const escuchas = new Set<() => void>();
const avisar = () => escuchas.forEach(f => f());

export function leerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(LS_TEMA);
    if (v === 'claro' || v === 'oscuro' || v === 'sistema') return v;
  } catch {
    /* almacenamiento bloqueado: se usa el valor inicial */
  }
  return PREFERENCIA_INICIAL;
}

function sistemaEsOscuro(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(MEDIA_OSCURO).matches;
}

export function temaEfectivo(pref: PreferenciaTema = leerPreferencia()): TemaEfectivo {
  return pref === 'oscuro' || (pref === 'sistema' && sistemaEsOscuro()) ? 'oscuro' : 'claro';
}

/** Refleja la preferencia en el documento: clase `dark` + color de la barra del navegador. */
function aplicar(): void {
  const oscuro = temaEfectivo() === 'oscuro';
  document.documentElement.classList.toggle('dark', oscuro);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', COLOR_BARRA[oscuro ? 'oscuro' : 'claro']);
}

export function guardarPreferencia(pref: PreferenciaTema): void {
  try {
    localStorage.setItem(LS_TEMA, pref);
  } catch {
    /* sin almacenamiento: el cambio rige hasta recargar */
  }
  aplicar();
  avisar();
}

/** Se llama una vez al arrancar (main.tsx). */
export function iniciarTema(): void {
  aplicar();

  // Con «Automático», seguir al sistema operativo cuando cambia (p. ej. anochece).
  window.matchMedia?.(MEDIA_OSCURO).addEventListener('change', () => {
    if (leerPreferencia() === 'sistema') {
      aplicar();
      avisar();
    }
  });

  // Otra pestaña cambió la preferencia.
  window.addEventListener('storage', e => {
    if (e.key === LS_TEMA) {
      aplicar();
      avisar();
    }
  });

  // Lo que se imprime (reportes, constancias) sale siempre en claro, esté como esté la pantalla.
  let estabaOscuro = false;
  const aClaro = () => {
    estabaOscuro = document.documentElement.classList.contains('dark');
    document.documentElement.classList.remove('dark');
  };
  const deVuelta = () => {
    if (estabaOscuro) document.documentElement.classList.add('dark');
    estabaOscuro = false;
  };
  window.addEventListener('beforeprint', aClaro);
  window.addEventListener('afterprint', deVuelta);
}

function suscribir(cb: () => void) {
  escuchas.add(cb);
  return () => {
    escuchas.delete(cb);
  };
}

/** Preferencia elegida + tema que efectivamente se está viendo, con re-render al cambiar. */
export function useTema() {
  const preferencia = useSyncExternalStore(suscribir, leerPreferencia, () => PREFERENCIA_INICIAL);
  return {
    preferencia,
    efectivo: temaEfectivo(preferencia),
    elegir: guardarPreferencia,
  };
}
