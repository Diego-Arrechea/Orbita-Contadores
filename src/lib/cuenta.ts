/**
 * Sesión del contador (auth REAL contra el backend). Se guarda en localStorage:
 *  - el token JWT (orbita_token), que apiClient manda en cada request,
 *  - el usuario logueado (orbita_usuario), del que derivamos la `Cuenta` que usa la UI.
 *
 * La pertenencia de cada cliente la resuelve el backend (filtra por usuario_id en cada request); el
 * front ya no mantiene ningún mapa local de dueños.
 */
import type { AuthResp, Usuario } from '@/services/authService';
import { queryClient } from '@/lib/queryClient';

export interface Cuenta {
  email: string;
  nombre: string; // nombre + apellido
  estudio: string;
  iniciales: string;
  datosEjemplo: boolean; // siempre false con cuentas reales (cada uno ve sólo lo suyo)
}

const LS_TOKEN = 'orbita_token';
const LS_USUARIO = 'orbita_usuario';
// Guard del modal de aviso de alertas (sessionStorage, por pestaña). Lo limpiamos en cada login para
// que el modal se re-evalúe por usuario: si no, al cambiar de cuenta en la misma pestaña el flag de la
// cuenta anterior tapaba el modal de la nueva. Lo consume src/components/shared/AvisoAlertas.tsx.
export const SS_AVISO_ALERTAS = 'orbita_aviso_alertas_sesion';
// Motivo por el que se cortó la sesión (cuenta deshabilitada, acceso suspendido). Lo escribe
// apiClient cuando el backend marca la sesión como terminada y lo levanta el login para explicarle
// a la persona por qué la sacaron, en vez de dejarla adivinando. Se borra al mostrarlo.
const SS_MOTIVO_SALIDA = 'orbita_motivo_salida';

/** Guarda el motivo por el que se cerró la sesión, para mostrarlo en el login. */
export function guardarMotivoSalida(motivo: string): void {
  try {
    sessionStorage.setItem(SS_MOTIVO_SALIDA, motivo);
  } catch {
    /* ignore */
  }
}

/** Devuelve (y consume) el motivo del último cierre forzado de sesión, si lo hubo. */
export function tomarMotivoSalida(): string | null {
  try {
    const motivo = sessionStorage.getItem(SS_MOTIVO_SALIDA);
    if (motivo) sessionStorage.removeItem(SS_MOTIVO_SALIDA);
    return motivo;
  } catch {
    return null;
  }
}
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
    // Cambió la identidad: re-evaluar el modal de aviso para la cuenta nueva (ver SS_AVISO_ALERTAS).
    sessionStorage.removeItem(SS_AVISO_ALERTAS);
  } catch {
    /* ignore */
  }
  // Cambió la identidad de la sesión (login / "entrar como"): tiramos TODO el caché de React Query,
  // si no la nueva cuenta vería datos cacheados de la anterior (p.ej. los clientes del admin al
  // impersonar). El backend filtra por usuario_id, así que cada dato es por-sesión.
  queryClient.clear();
  return usuarioToCuenta(auth.usuario);
}

/** Actualiza el usuario guardado (sin tocar el token). Lo usa el refresh de sesión al cargar la app
 * y al volver a la pestaña (getMe) para traer datos frescos —p.ej. un cambio de plan— sin obligar a
 * re-loguear. Avisa a la UI para que el menú se re-arme en el acto (ver useSesion). */
export function actualizarUsuarioGuardado(u: Usuario): void {
  try {
    const anterior = localStorage.getItem(LS_USUARIO);
    const nuevo = JSON.stringify(u);
    localStorage.setItem(LS_USUARIO, nuevo);
    if (anterior !== nuevo) avisarCambioDeSesion();
  } catch {
    /* ignore */
  }
}

// --- Aviso de cambios en la sesión -------------------------------------------------------------
// La UI lee el usuario de localStorage de forma síncrona, así que un cambio traído por getMe (por
// ejemplo, que le cambiaron el plan al estudio) no re-renderiza nada por sí solo. `versionSesion`
// se incrementa en cada cambio y los componentes se suscriben con useSesion() (useSyncExternalStore).
let version = 0;
const suscriptores = new Set<() => void>();

function avisarCambioDeSesion(): void {
  version += 1;
  suscriptores.forEach(cb => cb());
}

/** Se suscribe a los cambios de la sesión. Devuelve la función para desuscribirse. */
export function suscribirSesion(cb: () => void): () => void {
  suscriptores.add(cb);
  return () => suscriptores.delete(cb);
}

/** Contador que cambia cada vez que cambian los datos de la sesión (para useSyncExternalStore). */
export function versionSesion(): number {
  return version;
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
  queryClient.clear(); // que la próxima cuenta no herede datos cacheados de esta
}

/** ¿La cuenta logueada es administradora (acceso al panel superadmin)? */
export function esAdmin(): boolean {
  return usuarioActual()?.rol === 'admin';
}

/** ¿La cuenta logueada es un usuario del estudio (empleado creado desde Gestión de usuarios)?
 *  Ve sólo sus clientes asignados y navega restringido (sin Novedades/Configuración/Gestión). */
export function esEmpleado(): boolean {
  return usuarioActual()?.es_empleado === true;
}

/** Permisos que el titular puede prender/apagar por usuario del estudio (espejo de
 *  PERMISOS_EQUIPO del backend). */
export type PermisoEquipo =
  | 'nuevo_cliente'
  | 'editar_cliente'
  | 'eliminar_cliente'
  | 'actualizar_clave'
  | 'facturar'
  | 'conciliacion'
  | 'comunicaciones';

/** ¿La cuenta logueada puede hacer esta acción? Cuentas plenas: siempre sí. Usuarios del estudio:
 *  según los permisos que le dio el titular (ausente = habilitado). Sólo esconde UI: el backend
 *  valida igual en cada endpoint. */
export function tienePermiso(clave: PermisoEquipo): boolean {
  const u = usuarioActual();
  if (!u?.es_empleado) return true;
  return u.permisos?.[clave] !== false;
}

/** Funciones del producto que el plan del estudio puede habilitar o no (espejo de FUNCIONES en
 *  backend/app/services/suscripciones.py). */
export type FuncionPlan =
  | 'panel'
  | 'alertas'
  | 'vencimientos'
  | 'estado_cuenta'
  | 'facturacion'
  | 'conciliacion'
  | 'usuarios'
  | 'permisos'
  | 'iva'
  | 'contabilidad';

/** ¿El plan del estudio incluye esta función? Es lo que decide qué ve el contador en el menú y qué
 *  secciones puede abrir. Lo resuelve el backend (plan + estado de la suscripción + excepciones de
 *  la cuenta) y viaja en el usuario de la sesión; acá sólo se lee.
 *
 *  Sesiones abiertas desde antes de esta feature no tienen `funciones` guardadas: hasta el próximo
 *  getMe se asume que sí (no le apagamos nada a nadie por un dato que todavía no llegó). */
export function puedeUsar(clave: FuncionPlan): boolean {
  const funciones = usuarioActual()?.funciones;
  if (!funciones) return true;
  return funciones[clave] !== false;
}

/** ¿La cuenta logueada puede emitir comprobantes? Plan del estudio + rollout de facturación del
 *  backend + permiso por usuario del estudio (si el titular se lo apagó, no factura). */
export function puedeFacturar(): boolean {
  return usuarioActual()?.facturacion_habilitada === true && tienePermiso('facturar');
}

/** ¿La cuenta logueada puede ver el apartado de IVA? Sale del plan del estudio combinado con el
 *  rollout del backend. Sólo esconde/muestra el menú y la página: los endpoints validan igual. */
export function puedeVerIVA(): boolean {
  return usuarioActual()?.iva_habilitada === true;
}

/** ¿La cuenta logueada puede ver el apartado de Contabilidad? Mismo criterio que IVA. */
export function puedeVerContabilidad(): boolean {
  return usuarioActual()?.contabilidad_habilitada === true;
}

/** ¿El usuario REAL detrás de la sesión es admin? Sigue siendo true mientras "entra como" otro
 * contador (la sesión de admin queda respaldada en LS_IMP_*). Útil para diagnósticos que sólo debe
 * ver el superadmin aunque esté mirando la cartera de un contador impersonado. */
export function esAdminReal(): boolean {
  return esAdmin() || impersonando() !== null;
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
  // Volvió a la sesión de admin: limpia el caché del contador impersonado (el banner además recarga).
  queryClient.clear();
}
