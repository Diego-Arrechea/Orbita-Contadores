import { apiPost } from './apiClient';

/** Manda un WhatsApp de prueba al teléfono de la cuenta del contador logueado. */
export function enviarPruebaWhatsapp(): Promise<{ enviado: boolean; destino: string }> {
  return apiPost('/notificaciones/prueba', {});
}
