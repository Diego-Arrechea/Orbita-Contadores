/**
 * Cliente HTTP del backend de Órbita.
 * La base se configura con VITE_API_URL (.env.local); por defecto apunta al backend local.
 * Si hay sesión, adjunta el token JWT en el header Authorization automáticamente.
 */
import { tokenActual, logoutCuenta } from '@/lib/cuenta';

export const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api';

/** Error HTTP con el código de estado, para que el caller distinga 404 (permanente) de fallos transitorios. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Mergea el header Authorization (si hay token) con los headers que pase el caller. */
function conAuth(base?: Record<string, string>): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(base ?? {}) };
  const token = tokenActual();
  if (token) headers.Authorization = `Bearer ${token}`;
  return Object.keys(headers).length ? headers : undefined;
}

async function handle<T>(res: Response, publico = false): Promise<T> {
  // El 401 "cerrar sesión + ir al login" SÓLO aplica a requests AUTENTICADAS (token vencido/ inválido).
  // En endpoints públicos (login, registro, recuperación) un 401 es un error de credenciales: hay que
  // devolver el detalle del backend (ej. "Email o contraseña incorrectos"), NO "tu sesión expiró".
  if (res.status === 401 && !publico) {
    logoutCuenta();
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    throw new Error('Tu sesión expiró. Iniciá sesión de nuevo.');
  }
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new ApiError(res.status, `API ${res.status} ${res.statusText}: ${detalle}`);
  }
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return fetch(`${BASE_URL}${path}`, { headers: conAuth() }).then(handle<T>);
}

/** GET que devuelve binario (PDF, etc.). Mismo manejo de 401/errores que `apiGet`, pero Blob. */
export async function apiGetBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: conAuth() });
  if (res.status === 401) {
    logoutCuenta();
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    throw new Error('Tu sesión expiró. Iniciá sesión de nuevo.');
  }
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new ApiError(res.status, `API ${res.status} ${res.statusText}: ${detalle}`);
  }
  return res.blob();
}

export function apiPost<T>(path: string, body?: unknown, opts?: { publico?: boolean }): Promise<T> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: conAuth(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(res => handle<T>(res, opts?.publico));
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: conAuth(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handle<T>);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: conAuth(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(handle<T>);
}

export function apiDelete<T>(path: string): Promise<T> {
  return fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: conAuth() }).then(handle<T>);
}
