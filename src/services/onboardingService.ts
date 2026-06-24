import { apiGet, apiPost } from './apiClient';

export interface Representado {
  cuit: string;
  nombre: string;
}

export interface JobProgreso {
  estado: 'en_proceso' | 'terminado' | 'error' | 'cancelado';
  progreso: number;
  mensaje: string;
  resultados: Array<{
    cuit: string;
    nombre?: string;
    ok: boolean;
    error?: string;
    /** Sólo en sincronizaciones: cuántos comprobantes se trajeron de ARCA en esta corrida. */
    comprobantes?: number;
  }>;
  error: string | null;
}

/** Loguea con la clave del contador y devuelve sus CUITs operables (él + representados). */
export function listarRepresentados(cuit: string, clave: string): Promise<Representado[]> {
  return apiPost<Representado[]>('/onboarding/representados', { cuit, clave });
}

/** Inicia el bootstrap del cert de los clientes elegidos. Devuelve el job_id para el polling. */
export function iniciarMonitoreo(
  cuit: string,
  clave: string,
  seleccionados: Representado[],
): Promise<{ job_id: string }> {
  return apiPost<{ job_id: string }>('/onboarding/monitorear', { cuit, clave, seleccionados });
}

/** Estado del bootstrap en curso (para mover la barra de progreso). */
export function getProgresoMonitoreo(jobId: string): Promise<JobProgreso> {
  return apiGet<JobProgreso>(`/onboarding/monitorear/${jobId}`);
}

/** Cancela un alta en curso: el backend aborta y deshace los clientes que esa alta hubiera creado. */
export function cancelarMonitoreo(jobId: string): Promise<{ job_id: string; cancelado: boolean }> {
  return apiPost(`/onboarding/monitorear/${jobId}/cancelar`, {});
}

export interface SubirCertResultado {
  cuit: string;
  nombre: string;
  sincronizados: number;
  advertencia: string | null;
}

/** Carga manual de un cert ya emitido (el contador sube el .crt + la .key del cliente). */
export function subirCert(
  cuit: string,
  nombre: string,
  certPem: string,
  keyPem: string,
): Promise<SubirCertResultado> {
  return apiPost<SubirCertResultado>('/onboarding/subir-cert', {
    cuit,
    nombre,
    cert_pem: certPem,
    key_pem: keyPem,
  });
}
