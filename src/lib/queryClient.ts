import { QueryClient } from '@tanstack/react-query';

/**
 * Cliente de React Query para toda la app. Defaults pensados para un panel interno:
 * - staleTime 30s: al volver a una vista visitada hace poco, sirve el cache al instante (sin
 *   spinner) y revalida en segundo plano (localidad temporal). Cada query puede subir/bajar esto.
 * - gcTime 30min: el dato sobrevive en cache aunque desmontes el componente, por TODA la sesión de
 *   trabajo. Antes era 5min → si dejabas un tab cerrado más de eso, al reabrirlo el dato ya se había
 *   descartado y aparecía el spinner "Cargando…" de cero (los tabs de Radix desmontan el inactivo).
 *   Con 30min, reabrir un tab/vista dentro de la sesión muestra el cache al instante + revalida.
 * - refetchOnWindowFocus false: no re-pedimos al volver de otra pestaña del navegador (molesto en
 *   un panel); la frescura la maneja staleTime + refetchInterval donde haga falta.
 * - retry 1: un solo reintento ante error (los endpoints lentos/caídos no se machacan).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
