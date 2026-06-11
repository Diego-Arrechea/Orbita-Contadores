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
// Mientras un admin está "entrando como" otro contador, guardamos acá su sesión original (la de
// admin) para poder volver. Si existen, es señal de que hay una impersonación en curso.
const LS_IMP_TOKEN = 'orbita_admin_token';
const LS_IMP_USUARIO = 'orbita_admin_usuario';

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

/** Actualiza el usuario guardado (sin tocar el token). Lo usa el refresh de sesión al cargar la app
 * (getMe) para traer datos frescos —p.ej. los días de prueba restantes— sin obligar a re-loguear. */
export function actualizarUsuarioGuardado(u: Usuario): void {
  try {
    localStorage.setItem(LS_USUARIO, JSON.stringify(u));
  } catch {
    /* ignore */
  }
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
    localStorage.removeItem(LS_IMP_TOKEN);
    localStorage.removeItem(LS_IMP_USUARIO);
  } catch {
    /* ignore */
  }
}

/** ¿La cuenta logueada es administradora (acceso al panel superadmin)? */
export function esAdmin(): boolean {
  return usuarioActual()?.rol === 'admin';
}

/**
 * Empieza a "entrar como" otro contador: respalda la sesión de admin y activa la del contador.
 * Mientras dure, esAdmin() refleja al contador impersonado (no muestra el panel) y un banner global
 * permite volver con terminarImpersonacion().
 */
export function iniciarImpersonacion(auth: AuthResp): Cuenta {
  try {
    const tok = localStorage.getItem(LS_TOKEN);
    const usr = localStorage.getItem(LS_USUARIO);
    if (tok && usr) {
      localStorage.setItem(LS_IMP_TOKEN, tok);
      localStorage.setItem(LS_IMP_USUARIO, usr);
    }
  } catch {
    /* ignore */
  }
  return iniciarSesion(auth);
}

/** ¿Hay una impersonación en curso? Devuelve el nombre del admin original, o null. */
export function impersonando(): string | null {
  try {
    const raw = localStorage.getItem(LS_IMP_USUARIO);
    if (!raw) return null;
    const u = JSON.parse(raw) as Usuario;
    return `${u.nombre} ${u.apellido}`.trim() || u.email;
  } catch {
    return null;
  }
}

/** Vuelve a la sesión de admin original (deshace la impersonación). */
export function terminarImpersonacion(): void {
  try {
    const tok = localStorage.getItem(LS_IMP_TOKEN);
    const usr = localStorage.getItem(LS_IMP_USUARIO);
    if (tok && usr) {
      localStorage.setItem(LS_TOKEN, tok);
      localStorage.setItem(LS_USUARIO, usr);
    }
    localStorage.removeItem(LS_IMP_TOKEN);
    localStorage.removeItem(LS_IMP_USUARIO);
  } catch {
    /* ignore */
  }
}
