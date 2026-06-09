/**
 * Sesión del contador (auth REAL contra el backend). Se guarda en localStorage:
 *  - el token JWT (orbita_token), que apiClient manda en cada request,
 *  - el usuario logueado (orbita_usuario), del que derivamos la `Cuenta` que usa la UI.
 *
 * La pertenencia de cada cliente la resuelve el backend (filtra por usuario_id en cada request); el
 * front ya no mantiene ningún mapa local de dueños.
 */
import type { AuthResp, Usuario } from '@/services/authService';

export interface Cuenta {
  email: string;
  nombre: string; // nombre + apellido
  estudio: string;
  iniciales: string;
  datosEjemplo: boolean; // siempre false con cuentas reales (cada uno ve sólo lo suyo)
}

const LS_TOKEN = 'orbita_token';
const LS_USUARIO = 'orbita_usuario';

function iniciales(nombre: string, apellido: string): string {
  const a = nombre.trim()[0] ?? '';
  const b = apellido.trim()[0] ?? '';
  return (a + b).toUpperCase() || '—';
}

function usuarioToCuenta(u: Usuario): Cuenta {
  return {
    email: u.email,
    nombre: `${u.nombre} ${u.apellido}`.trim(),
    estudio: u.estudio,
    iniciales: iniciales(u.nombre, u.apellido),
    datosEjemplo: false,
  };
}

/** Guarda la sesión (token + usuario) tras un login/registro exitoso. */
export function iniciarSesion(auth: AuthResp): Cuenta {
  try {
    localStorage.setItem(LS_TOKEN, auth.token);
    localStorage.setItem(LS_USUARIO, JSON.stringify(auth.usuario));
  } catch {
    /* ignore */
  }
  return usuarioToCuenta(auth.usuario);
}

/** El usuario logueado completo (todos sus datos), o null si no hay sesión. */
export function usuarioActual(): Usuario | null {
  try {
    const raw = localStorage.getItem(LS_USUARIO);
    return raw ? (JSON.parse(raw) as Usuario) : null;
  } catch {
    return null;
  }
}

/** La `Cuenta` (forma que consume la UI) del usuario logueado, o null. */
export function cuentaActual(): Cuenta | null {
  const u = usuarioActual();
  return u ? usuarioToCuenta(u) : null;
}

/** El token JWT de la sesión (lo usa apiClient para el header Authorization). */
export function tokenActual(): string | null {
  try {
    return localStorage.getItem(LS_TOKEN);
  } catch {
    return null;
  }
}

export function logoutCuenta(): void {
  try {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USUARIO);
  } catch {
    /* ignore */
  }
}
