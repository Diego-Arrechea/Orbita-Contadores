/**
 * Gestión de usuarios del estudio: el titular crea cuentas para su equipo, les prende/apaga
 * permisos y les asigna clientes. Sólo cuentas plenas (el backend valida con titular_actual);
 * un usuario del estudio no puede administrar el equipo.
 */
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './apiClient';
import type { PermisoEquipo } from '@/lib/cuenta';

export interface Miembro {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  activo: boolean;
  permisos: Record<PermisoEquipo, boolean>;
  clientes: number; // cuántos clientes tiene asignados
  creado_en?: string | null;
  ultimo_acceso?: string | null; // null = nunca inició sesión
}

export interface MiembroAlta {
  nombre: string;
  apellido: string;
  email: string;
  password: string;
  permisos?: Partial<Record<PermisoEquipo, boolean>>;
}

export function getMiembros(): Promise<Miembro[]> {
  return apiGet<Miembro[]>('/equipo/miembros');
}

export function crearMiembro(datos: MiembroAlta): Promise<Miembro> {
  return apiPost<Miembro>('/equipo/miembros', datos);
}

/** PATCH parcial: mandá sólo lo que cambia (activo, permisos y/o password nueva). */
export function editarMiembro(
  id: number,
  cambios: {
    activo?: boolean;
    permisos?: Partial<Record<PermisoEquipo, boolean>>;
    password?: string;
  }
): Promise<Miembro> {
  return apiPatch<Miembro>(`/equipo/miembros/${id}`, cambios);
}

/** Elimina la cuenta del miembro; sus clientes asignados pasan al titular. */
export function eliminarMiembro(
  id: number
): Promise<{ ok: boolean; clientes_reasignados: number }> {
  return apiDelete(`/equipo/miembros/${id}`);
}

/** Cambia el responsable de un cliente dentro del equipo (id del titular o de un miembro). */
export function asignarCliente(
  cuit: string,
  usuarioId: number
): Promise<{ ok: boolean; cuit: string; usuario_id: number }> {
  return apiPut(`/equipo/clientes/${cuit.replace(/\D/g, '')}/asignar`, { usuario_id: usuarioId });
}

/** Asigna EN LOTE varios clientes a un responsable (modal "Asignar clientes"). */
export function asignarClientes(
  usuarioId: number,
  cuits: string[]
): Promise<{ ok: boolean; asignados: number }> {
  return apiPut('/equipo/clientes/asignar', {
    usuario_id: usuarioId,
    cuits: cuits.map(c => c.replace(/\D/g, '')),
  });
}
