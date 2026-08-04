/**
 * Hooks de query compartidos (React Query) para datos de clientes. Centralizan las query keys así la
 * invalidación es consistente desde un solo lugar (ver components/shared/InvalidadorCache).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cliente } from '@/types';
import { getClientesReales, getClienteReal, getHistorico } from '@/services/clientesService';
import { getComunicaciones } from '@/services/comunicacionesService';
import { getLiquidacionesAgro } from '@/services/liquidacionesAgroService';

export const qkClientes = ['clientes', 'reales'] as const;
export const qkCliente = (cuit: string) => ['cliente', cuit] as const;
export const qkComunicaciones = (cuit: string) => ['comunicaciones', cuit] as const;
export const qkLiquidacionesAgro = (cuit: string) => ['liquidaciones-agro', cuit] as const;
export const qkHistorico = (cuit: string, rango: number) => ['historico', cuit, rango] as const;

/** Cartera completa del contador (cacheada). La consumen Dashboard, Conciliación y useAlertas: una
 *  sola request compartida en vez de tres. */
export function useClientesReales() {
  return useQuery({ queryKey: qkClientes, queryFn: getClientesReales });
}

/** Un cliente real por CUIT (ficha / reporte). `enabled` evita pedir cuando se usa el mock.
 *  Mientras llega el detalle completo, la ficha pinta AL INSTANTE con el dato que ya tiene la
 *  lista cacheada (misma forma, sin comprobantes); el detalle la reemplaza al llegar. */
export function useClienteReal(cuit: string | undefined, enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['cliente', cuit ?? ''],
    queryFn: () => getClienteReal(cuit as string),
    enabled: enabled && !!cuit,
    placeholderData: () => qc.getQueryData<Cliente[]>(qkClientes)?.find(c => c.cuit === cuit),
  });
}

/** Comunicaciones del Domicilio Fiscal Electrónico de un cliente (sólo clientes reales). */
export function useComunicaciones(cuit: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['comunicaciones', cuit ?? ''],
    queryFn: () => getComunicaciones(cuit as string),
    enabled: enabled && !!cuit,
  });
}

/** Facturación agropecuaria de un cliente (liquidaciones del sector primario). Sólo si le aplica. */
export function useLiquidacionesAgro(cuit: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['liquidaciones-agro', cuit ?? ''],
    queryFn: () => getLiquidacionesAgro(cuit as string),
    enabled: enabled && !!cuit,
  });
}

/** Facturación histórica de un cliente para el gráfico de rango variable (nominal + ajustado por
 *  inflación). Cacheada por CUIT y rango; sólo para clientes reales. */
export function useHistorico(cuit: string | undefined, rango: number, enabled = true) {
  return useQuery({
    queryKey: ['historico', cuit ?? '', rango],
    queryFn: () => getHistorico(cuit as string, rango),
    enabled: enabled && !!cuit,
  });
}
