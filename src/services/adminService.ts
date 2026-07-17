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
  email_confirmado?: boolean; // confirmó su correo al registrarse
  creado_en?: string | null;
  ultimo_acceso?: string | null;
  ultimo_logout?: string | null; // ISO: última vez que cerró la app
  clientes: number;
  empleados?: number; // subcuentas de empleado que dependen de esta cuenta (equipo del estudio)
}

export interface AdminMetricas {
  total_cuentas: number;
  cuentas_activas: number;
  cuentas_inactivas: number;
  mails_confirmados: number;
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

export interface AdminSyncFallida {
  fecha: string;
  cuit: string;
  cliente?: string | null;
  contador_email?: string | null;
  motivo?: string | null;
  duracion_ms?: number | null;
  resuelto: boolean;
  ultima_sync_ok?: string | null;
}

export interface JobEstado {
  estado: string; // en_proceso | terminado | error
  progreso: number;
  mensaje: string;
  error?: string | null;
}

export interface AdminClienteHistorialMes {
  mes: string;
  emitidasNetas: number;
  recibidas: number;
}

/** Un cliente en la vista global del panel (read-only): mismo dato que ve su contador + de quién es. */
export interface AdminCliente {
  cuit: string;
  nombre: string;
  regimen?: string | null;
  categoria?: string | null;
  cuota_estado?: string | null;
  prox_venc_fecha?: string | null;
  facturacion_12m?: number | null;
  tope_categoria?: number | null;
  ultima_extraccion?: string | null;
  resultado_ultima_extraccion?: string | null; // exitosa | fallida | null
  motivo_ultima_extraccion?: string | null;
  tiene_comprobantes: boolean;
  historial_mensual: AdminClienteHistorialMes[];
  contador_id?: number | null;
  contador_email?: string | null;
  contador_nombre?: string | null;
  cantidad_comprobantes: number;
}

export function listarUsuarios(): Promise<AdminUsuario[]> {
  return apiGet<AdminUsuario[]>('/admin/usuarios');
}

export function obtenerMetricas(): Promise<AdminMetricas> {
  return apiGet<AdminMetricas>('/admin/metricas');
}

export interface AdminCaptchaPorCuit {
  cuit: string;
  nombre?: string | null;
  eventos: number;
  resueltos: number;
  ultima?: string | null;
}

export interface AdminCaptchaMetricas {
  total_eventos: number; // veces que apareció el captcha (en general)
  cuentas_distintas: number; // en cuántas cuentas distintas apareció
  total_clientes: number;
  pct_cuentas_afectadas: number;
  eventos_resueltos: number;
  eventos_no_resueltos: number;
  dias_ventana: number;
  eventos_en_ventana: number;
  cuentas_en_ventana: number;
  por_cuit: AdminCaptchaPorCuit[];
}

export function obtenerMetricasCaptcha(): Promise<AdminCaptchaMetricas> {
  return apiGet<AdminCaptchaMetricas>('/admin/metricas/captcha');
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

/** Genera y fija una contraseña temporal para un contador. La devuelve para mostrarla una vez. */
export function restablecerPasswordUsuario(
  id: number
): Promise<{ password_temporal: string }> {
  return apiPost<{ password_temporal: string }>(`/admin/usuarios/${id}/restablecer-password`);
}

export function listarAuditoria(): Promise<AdminAuditoria[]> {
  return apiGet<AdminAuditoria[]>('/admin/auditoria');
}

export function listarSincronizacionesFallidas(): Promise<AdminSyncFallida[]> {
  return apiGet<AdminSyncFallida[]>('/admin/sincronizaciones/fallidas');
}

/** Aviso (no fallo): cliente cuyo nombre quedó como "Titular <CUIT>" al darse de alta. */
export interface AdminAvisoNombre {
  cuit: string;
  cliente?: string | null;
  contador_email?: string | null;
}

export function listarAvisosNombre(): Promise<AdminAvisoNombre[]> {
  return apiGet<AdminAvisoNombre[]>('/admin/clientes/nombre-sin-confirmar');
}

/** Dispara un reintento de sincronización para cualquier cliente. Devuelve el job_id a poolear. */
export function reintentarSync(cuit: string): Promise<{ job_id: string }> {
  return apiPost<{ job_id: string }>(`/admin/clientes/${cuit}/reintentar-sync`);
}

/** Estado de un job de sincronización en background (mismo endpoint que usa el contador). */
export function estadoSync(jobId: string): Promise<JobEstado> {
  return apiGet<JobEstado>(`/sincronizaciones/${jobId}`);
}

/** TODOS los clientes de TODAS las cuentas (vista global read-only del superadmin). */
export function listarTodosLosClientes(): Promise<AdminCliente[]> {
  return apiGet<AdminCliente[]>('/admin/clientes');
}

export interface AdminContadorResumen {
  total_clientes: number;
  clientes_con_comprobantes: number;
  comprobantes_total: number;
  facturado_12m_total: number;
  syncs_problemas: number;
  whatsapp_activo: boolean; // recibe avisos por WhatsApp (canal prendido + teléfono cargado)
}

/** Ficha completa de un contador: sus datos + resumen agregado + sus clientes. */
export interface AdminContadorFicha {
  usuario: AdminUsuario;
  resumen: AdminContadorResumen;
  clientes: AdminCliente[];
}

export function obtenerFichaContador(id: number): Promise<AdminContadorFicha> {
  return apiGet<AdminContadorFicha>(`/admin/usuarios/${id}/ficha`);
}

// --- Motor de sincronización continua ---

export interface MotorCliente {
  cuit: string;
  cliente?: string | null;
  contador_email?: string | null;
  ultima?: string | null;
  horas_desde?: number | null;
  resultado?: string | null; // exitosa | fallida
  comprobantes?: number | null;
  duracion_seg?: number | null;
}

export interface MotorEstado {
  worker_vivo: boolean;
  worker_actualizado?: string | null;
  en_vuelo: MotorCliente[];
  concurrencia: number;
  intervalo_horas: number;
  total_clientes: number;
  frescos: number;
  pendientes: number;
  nunca: number;
  con_falla_actual: number;
  syncs_1h: number;
  syncs_24h: number;
  exitosas_24h: number;
  fallidas_24h: number;
  duracion_promedio_seg: number | null;
  proximos: MotorCliente[];
  actividad: MotorCliente[];
}

/** Estado del motor de sincronización continua (latido del worker + cobertura + actividad). */
export function obtenerEstadoMotor(): Promise<MotorEstado> {
  return apiGet<MotorEstado>('/admin/motor');
}
