import { QueryClient } from '@tanstack/react-query';

/**
 * Cliente de React Query para toda la app. Defaults pensados para un panel interno:
 * - staleTime 30s: al volver a una vista visitada hace poco, sirve el cache al instante (sin
 *   spinner) y revalida en segundo plano (localidad temporal). Cada query puede subir/bajar esto.
 * - gcTime 5min: el dato sobrevive en cache aunque desmontes el componente, por si volvés pronto.
 * - refetchOnWindowFocus false: no re-pedimos al volver de otra pestaña del navegador (molesto en
 *   un panel); la frescura la maneja staleTime + refetchInterval donde haga falta.
 * - retry 1: un solo reintento ante error (los endpoints lentos/caídos no se machacan).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
