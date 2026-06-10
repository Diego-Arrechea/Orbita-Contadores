/**
 * Servicio del panel superadmin (sólo cuentas con rol 'admin'; el backend lo valida con
 * admin_actual). Gestiona todas las cuentas de contadores: listado + métricas, activar/desactivar,
 * cambiar rol, impersonar y auditoría.
 */
import { apiGet, apiPatch, apiPost } from './apiClient';
import type { AuthResp } from './authService';

export interface AdminUsuario {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  cuit: string;
  estudio: string;
  matricula?: string | null;
  rol: string; // contador | admin
  activo: boolean;
  creado_en?: string | null;
  ultimo_acceso?: string | null;
  clientes: number;
}

export interface AdminMetricas {
  total_cuentas: number;
  cuentas_activas: number;
  cuentas_inactivas: number;
  total_admins: number;
  total_clientes: number;
  syncs_hoy: number;
  syncs_fallidas_hoy: number;
  nuevas_cuentas_semana: number;
}

export interface AdminAuditoria {
  id: number;
  admin_email: string;
  accion: string;
  target_email: string;
  detalle?: string | null;
  fecha: string;
}

export function listarUsuarios(): Promise<AdminUsuario[]> {
  return apiGet<AdminUsuario[]>('/admin/usuarios');
}

export function obtenerMetricas(): Promise<AdminMetricas> {
  return apiGet<AdminMetricas>('/admin/metricas');
}

export function editarUsuario(
  id: number,
  cambios: { activo?: boolean; rol?: string }
): Promise<AdminUsuario> {
  return apiPatch<AdminUsuario>(`/admin/usuarios/${id}`, cambios);
}

export function impersonar(id: number): Promise<AuthResp> {
  return apiPost<AuthResp>(`/admin/usuarios/${id}/impersonar`);
}

export function listarAuditoria(): Promise<AdminAuditoria[]> {
  return apiGet<AdminAuditoria[]>('/admin/auditoria');
}
