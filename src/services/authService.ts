/**
 * Auth del contador (login propio de Órbita) contra el backend.
 * Sólo HTTP: la sesión (token + usuario en localStorage) la maneja src/lib/cuenta.ts.
 */
import { apiGet, apiPost } from './apiClient';

export interface Usuario {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  dni: string;
  cuit: string;
  estudio: string;
  matricula?: string | null;
  rol?: string; // 'contador' | 'admin' — el front muestra el panel superadmin sólo si 'admin'
  email_confirmado?: boolean; // false → mostramos el banner "confirmá tu correo"
  trial_fin?: string | null; // ISO: fin del período de prueba gratis (30 días)
  trial_dias_restantes?: number | null; // snapshot del backend; el front recalcula desde trial_fin
}

export interface AuthResp {
  token: string;
  usuario: Usuario;
}

export interface RegistroPayload {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  dni: string;
  cuit: string;
  estudio: string;
  matricula?: string;
  password: string;
  acepto_terminos: boolean;
}

export function registrar(datos: RegistroPayload): Promise<AuthResp> {
  return apiPost<AuthResp>('/auth/registro', datos);
}

export function login(email: string, password: string): Promise<AuthResp> {
  return apiPost<AuthResp>('/auth/login', { email, password });
}

/** Datos del contador logueado (rehidrata/valida la sesión). Lanza si el token no sirve. */
export function getMe(): Promise<Usuario> {
  return apiGet<Usuario>('/auth/me');
}

/** Cambia la contraseña del contador logueado (requiere la actual). */
export function cambiarPassword(
  passwordActual: string,
  passwordNueva: string
): Promise<{ ok: boolean }> {
  return apiPost('/auth/cambiar-password', {
    password_actual: passwordActual,
    password_nueva: passwordNueva,
  });
}

/** Pide el enlace de recuperación de contraseña. Responde igual exista o no el email. */
export function recuperarPassword(email: string): Promise<{ mensaje: string }> {
  return apiPost('/auth/recuperar', { email });
}

/** Fija una contraseña nueva usando el token del enlace de recuperación. */
export function restablecerPassword(
  token: string,
  passwordNueva: string
): Promise<{ ok: boolean }> {
  return apiPost('/auth/restablecer', { token, password_nueva: passwordNueva });
}

/** Confirma el email usando el token del enlace que se mandó al registrarse (ruta pública). */
export function confirmarEmail(token: string): Promise<{ ok: boolean }> {
  return apiPost('/auth/confirmar-email', { token });
}

/** Reenvía el correo de confirmación al contador logueado (botón del banner). */
export function reenviarConfirmacion(): Promise<{ ok: boolean; ya_confirmado?: boolean }> {
  return apiPost('/auth/reenviar-confirmacion', {});
}

/**
 * Traduce el Error que lanza apiClient ("API <status> ...: <body>") al texto que mostramos.
 * Soporta el `detail` de FastAPI (string o el array de validación 422) y el fallo de red.
 */
export function mensajeDeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Ocurrió un error inesperado.';
  if (/failed to fetch|networkerror/i.test(err.message)) {
    return 'No se pudo conectar con el servidor. ¿Está levantado el backend?';
  }
  const m = err.message.match(/^API \d+ [^:]*: (.*)$/s);
  if (!m) return err.message;
  try {
    const detail = (JSON.parse(m[1]) as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const msg = String((detail[0] as { msg?: string }).msg ?? '');
      return msg.replace(/^(Value error|Assertion failed),\s*/i, '') || m[1];
    }
  } catch {
    /* el body no era JSON */
  }
  return m[1] || err.message;
}
