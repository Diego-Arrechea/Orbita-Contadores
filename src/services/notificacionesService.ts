import { apiPost } from './apiClient';

export interface PruebaResp {
  enviado: boolean;
  destino: string;
  sid: string;
}

/** Manda un WhatsApp de prueba. Si no se pasa número, el backend usa el teléfono de la cuenta. */
export function enviarWhatsappPrueba(numero?: string): Promise<PruebaResp> {
  return apiPost<PruebaResp>('/notificaciones/prueba', numero ? { numero } : {});
}
