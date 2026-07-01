import { apiGet, apiPost } from './apiClient';

/** Una comunicación del Domicilio Fiscal Electrónico (shape que devuelve el backend). */
export interface Comunicacion {
  id: string;
  fechaPublicacion: string | null;
  fechaVencimiento: string | null;
  sistema: string | null;
  organismo: string | null;
  asunto: string | null;
  detalle: string | null;
  prioridad: string | null;
  tieneAdjunto: boolean;
  leidaArca: boolean;
  vista: boolean; // el contador la abrió en Órbita (drive del punto rojo)
}

const soloDigitos = (cuit: string) => cuit.replace(/\D/g, '');

/** Comunicaciones cacheadas del cliente (más reciente primero). */
export function getComunicaciones(cuit: string): Promise<Comunicacion[]> {
  return apiGet<Comunicacion[]>(`/clientes/${soloDigitos(cuit)}/comunicaciones`);
}

/** Refresca a demanda las comunicaciones desde el organismo (en desarrollo, sin esperar al motor). */
export function sincronizarComunicaciones(cuit: string): Promise<Comunicacion[]> {
  return apiPost<Comunicacion[]>(`/clientes/${soloDigitos(cuit)}/comunicaciones/sincronizar`);
}

/** El contador abrió la comunicación: baja el detalle y la marca vista (apaga el punto rojo). */
export function marcarComunicacionVista(cuit: string, id: string): Promise<Comunicacion> {
  return apiPost<Comunicacion>(
    `/clientes/${soloDigitos(cuit)}/comunicaciones/${encodeURIComponent(id)}/marcar-vista`,
  );
}
