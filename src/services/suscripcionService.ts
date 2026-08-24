/**
 * Suscripción del estudio: lo que ve el contador en "Mi suscripción" (sólo lectura) y la gestión
 * completa desde el panel superadmin (planes, precios, vencimientos y cobranza).
 *
 * La suscripción es de la CUENTA PLENA (el titular): los usuarios del estudio quedan cubiertos por
 * la del titular y no ven el apartado.
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient';

export type EstadoSuscripcion = 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'sin_cargo';
export type CicloSuscripcion = 'mensual' | 'anual';
export type MedioPago = 'transferencia' | 'efectivo' | 'mercadopago' | 'tarjeta' | 'otro';

export interface Plan {
  clave: string;
  nombre: string;
  precio: number; // de lista, por mes
  limite_clientes: number | null; // null = sin tope
  descripcion: string;
  incluye: string[]; // qué trae el plan (bullets de la comparativa)
}

export interface PagoSuscripcion {
  id: number;
  fecha: string; // ISO aaaa-mm-dd
  importe: number;
  medio: string;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  referencia?: string | null;
  notas?: string | null;
  registrado_por?: string;
}

/** La suscripción tal como la ve su contador. */
export interface MiSuscripcion {
  plan: string;
  plan_nombre: string;
  plan_descripcion: string;
  estado: EstadoSuscripcion;
  ciclo: CicloSuscripcion;
  precio: number;
  inicio?: string | null;
  vence?: string | null;
  dias_restantes?: number | null;
  al_dia: boolean;
  limite_clientes?: number | null;
  clientes_en_uso: number;
  pagos: PagoSuscripcion[];
}

/** Una fila del listado de suscripciones del panel admin. */
export interface AdminSuscripcion {
  usuario_id: number;
  email: string;
  nombre: string;
  apellido: string;
  estudio: string;
  activo: boolean;
  creado_en?: string | null;
  ultimo_acceso?: string | null;
  plan: string;
  plan_nombre: string;
  estado: EstadoSuscripcion; // efectivo (ya considera el vencimiento)
  estado_guardado: EstadoSuscripcion;
  ciclo: CicloSuscripcion;
  precio: number;
  precio_personalizado: boolean;
  inicio?: string | null;
  vence?: string | null;
  dias_restantes?: number | null;
  limite_clientes?: number | null;
  clientes: number;
  ultimo_pago?: string | null;
  total_pagado: number;
  notas?: string | null;
}

export interface AdminSuscripcionesResumen {
  cuentas: number;
  activas: number;
  en_prueba: number;
  vencidas: number;
  canceladas: number;
  sin_cargo: number;
  ingreso_mensual: number;
  cobrado_30d: number;
  por_vencer_30d: number;
}

export interface AdminSuscripciones {
  resumen: AdminSuscripcionesResumen;
  items: AdminSuscripcion[];
}

export interface AdminSuscripcionDetalle {
  suscripcion: AdminSuscripcion;
  pagos: PagoSuscripcion[];
}

export interface CambiosSuscripcion {
  plan?: string;
  estado?: EstadoSuscripcion;
  ciclo?: CicloSuscripcion;
  precio?: number | null;
  limite_clientes?: number | null;
  inicio?: string | null;
  vence?: string | null;
  notas?: string | null;
}

export interface NuevoPago {
  fecha?: string | null;
  importe: number;
  medio: MedioPago;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  referencia?: string | null;
  notas?: string | null;
}

// --- Contador ---

export function obtenerMiSuscripcion(): Promise<MiSuscripcion> {
  return apiGet<MiSuscripcion>('/suscripcion');
}

export function listarPlanes(): Promise<Plan[]> {
  return apiGet<Plan[]>('/suscripcion/planes');
}

// --- Panel admin ---

export function listarSuscripciones(): Promise<AdminSuscripciones> {
  return apiGet<AdminSuscripciones>('/admin/suscripciones');
}

export function obtenerSuscripcion(usuarioId: number): Promise<AdminSuscripcionDetalle> {
  return apiGet<AdminSuscripcionDetalle>(`/admin/suscripciones/${usuarioId}`);
}

export function editarSuscripcion(
  usuarioId: number,
  cambios: CambiosSuscripcion
): Promise<AdminSuscripcion> {
  return apiPatch<AdminSuscripcion>(`/admin/suscripciones/${usuarioId}`, cambios);
}

export function registrarPago(
  usuarioId: number,
  pago: NuevoPago
): Promise<AdminSuscripcionDetalle> {
  return apiPost<AdminSuscripcionDetalle>(`/admin/suscripciones/${usuarioId}/pagos`, pago);
}

export function borrarPago(
  usuarioId: number,
  pagoId: number
): Promise<AdminSuscripcionDetalle> {
  return apiDelete<AdminSuscripcionDetalle>(`/admin/suscripciones/${usuarioId}/pagos/${pagoId}`);
}

/** Etiqueta + tono para mostrar el estado de una suscripción. */
export const ESTADO_SUSCRIPCION_META: Record<
  EstadoSuscripcion,
  { label: string; tono: 'success' | 'warning' | 'danger' | 'muted' | 'default' }
> = {
  activa: { label: 'Al día', tono: 'success' },
  prueba: { label: 'En prueba', tono: 'default' },
  vencida: { label: 'Vencida', tono: 'danger' },
  cancelada: { label: 'Cancelada', tono: 'muted' },
  sin_cargo: { label: 'Sin cargo', tono: 'muted' },
};
