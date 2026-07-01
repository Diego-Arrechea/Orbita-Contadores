/**
 * Hooks de query compartidos (React Query) para datos de clientes. Centralizan las query keys así la
 * invalidación es consistente desde un solo lugar (ver components/shared/InvalidadorCache).
 */
import { useQuery } from '@tanstack/react-query';
import { getClientesReales, getClienteReal } from '@/services/clientesService';
import { getComunicaciones } from '@/services/comunicacionesService';

export const qkClientes = ['clientes', 'reales'] as const;
export const qkCliente = (cuit: string) => ['cliente', cuit] as const;
export const qkComunicaciones = (cuit: string) => ['comunicaciones', cuit] as const;

/** Cartera completa del contador (cacheada). La consumen Dashboard, Conciliación y useAlertas: una
 *  sola request compartida en vez de tres. */
export function useClientesReales() {
  return useQuery({ queryKey: qkClientes, queryFn: getClientesReales });
}

/** Un cliente real por CUIT (ficha / reporte). `enabled` evita pedir cuando se usa el mock. */
export function useClienteReal(cuit: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['cliente', cuit ?? ''],
    queryFn: () => getClienteReal(cuit as string),
    enabled: enabled && !!cuit,
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
