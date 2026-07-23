/**
 * Auth del contador (login propio de Órbita) contra el backend.
 * Sólo HTTP: la sesión (token + usuario en localStorage) la maneja src/lib/cuenta.ts.
 */
import { apiGet, apiPatch, apiPost, BASE_URL } from './apiClient';
import { tokenActual } from '@/lib/cuenta';

export interface Usuario {
  id: number;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  dni: string;
  cuit: string | null; // las cuentas de usuario del estudio (empleados) no cargan CUIT
  estudio: string;
  matricula?: string | null;
  rol?: string; // 'contador' | 'admin' — el front muestra el panel superadmin sólo si 'admin'
  email_confirmado?: boolean; // false → mostramos el banner "confirmá tu correo"
  aviso_alertas_pendiente?: number; // ingresos que faltan para dejar de mostrar el modal de alertas (0 = no)
  facturacion_habilitada?: boolean; // rollout gateado: el front muestra "Emitir comprobante" sólo si true
  iva_habilitada?: boolean; // rollout gateado: el front muestra el apartado de IVA sólo si true
  /** true = cuenta de usuario del estudio (la creó el titular en Gestión de usuarios): navegación
   *  restringida (sin Novedades/Configuración/Gestión) y acciones acotadas por `permisos`. */
  es_empleado?: boolean;
  /** Permisos efectivos del usuario del estudio ({clave: bool}); null/ausente en cuentas plenas.
   *  El front sólo ESCONDE botones: la puerta real está en el backend. */
  permisos?: Record<string, boolean> | null;
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
  return apiPost<AuthResp>('/auth/registro', datos, { publico: true });
}

export function login(email: string, password: string): Promise<AuthResp> {
  // `publico: true` → un 401 acá es "credenciales incorrectas" (no "sesión expirada"): el caller
  // muestra el detalle del backend ("Email o contraseña incorrectos").
  return apiPost<AuthResp>('/auth/login', { email, password }, { publico: true });
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

export interface PerfilPayload {
  nombre: string;
  apellido: string;
  telefono: string;
  estudio: string;
  matricula?: string;
}

/** Actualiza los datos editables de la cuenta (nombre, apellido, teléfono, estudio, matrícula).
 *  Devuelve el usuario actualizado para refrescar la sesión. */
export function actualizarPerfil(datos: PerfilPayload): Promise<Usuario> {
  return apiPatch<Usuario>('/auth/perfil', datos);
}

/** Borra definitivamente la cuenta del contador logueado. Requiere la contraseña (segundo chequeo). */
export function borrarCuenta(password: string): Promise<{ ok: boolean }> {
  return apiPost('/auth/borrar-cuenta', { password });
}

/** Registra que se mostró el modal de lanzamiento de alertas: descuenta un ingreso (descartar=false)
 *  o lo apaga del todo (descartar=true, botón "Entendido"). Devuelve los ingresos que quedan. */
export function registrarAvisoAlertas(descartar: boolean): Promise<{ aviso_alertas_pendiente: number }> {
  return apiPost('/auth/aviso-alertas', { descartar });
}

/** Pide el enlace de recuperación de contraseña. Responde igual exista o no el email. */
export function recuperarPassword(email: string): Promise<{ mensaje: string }> {
  return apiPost('/auth/recuperar', { email }, { publico: true });
}

/** Fija una contraseña nueva usando el token del enlace de recuperación. */
export function restablecerPassword(
  token: string,
  passwordNueva: string
): Promise<{ ok: boolean }> {
  return apiPost('/auth/restablecer', { token, password_nueva: passwordNueva }, { publico: true });
}

/** Confirma el email usando el token del enlace que se mandó al registrarse (ruta pública). */
export function confirmarEmail(token: string): Promise<{ ok: boolean }> {
  return apiPost('/auth/confirmar-email', { token }, { publico: true });
}

/** Reenvía el correo de confirmación al contador logueado (botón del banner). */
export function reenviarConfirmacion(): Promise<{ ok: boolean; ya_confirmado?: boolean }> {
  return apiPost('/auth/reenviar-confirmacion', {});
}

/**
 * Avisa al backend que el contador cierra la app (sesión explícita o cierre de pestaña), para que el
 * panel admin registre el "último cierre". Best-effort: usa `keepalive` para que el request sobreviva
 * al unload de la página, no lanza si falla y no invalida la sesión (sólo deja el timestamp).
 */
export function registrarLogout(): void {
  const token = tokenActual();
  if (!token) return;
  try {
    void fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
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
