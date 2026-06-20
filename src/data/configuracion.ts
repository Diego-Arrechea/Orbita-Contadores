import type { Configuracion } from '@/types';
import { ventanasRecategorizacion } from '@/lib/recategorizacion';

export const CONFIGURACION_INICIAL: Configuracion = {
  // Ventanas de recategorización oficiales (vencen 5/8 y 5/2), generadas a partir de la fecha
  // actual para que nunca queden vencidas. Ver src/lib/recategorizacion.ts.
  ventanas: ventanasRecategorizacion(),
  // Inflación mensual estimada para proyectar la facturación a 12 meses (compuesta). Es el valor que
  // usa el cálculo (vía CONFIGURACION_INICIAL); editalo según el escenario. 0.02 = 2%/mes; 0 = sin inflación.
  inflacionMensualProyeccion: 0.02,
  umbralAmarilloPorcentaje: 0.80,
  umbralAmarilloDias: 45,
  umbralRojoDias: 15,
  umbralRatioGastosAmarillo: 0.70,
  // Una deuda de cuota es urgente sólo si supera el 10% de la cuota del mes; por debajo es un aviso
  // (evita que un resto de intereses/redondeo de $200 se marque como urgente).
  umbralDeudaCuotaUrgente: 0.10,
  // Alertas por WhatsApp: apagadas por defecto (el contador las activa). Ventana horaria 9–21,
  // sólo urgentes y todos los tipos. Estos defaults coinciden con NOTIF_DEFAULT del backend
  // (backend/app/services/alertas.py): si cambiás uno, cambiá el otro.
  notificaciones: {
    activo: false,
    horaDesde: 9,
    horaHasta: 21,
    tipos: ['tope', 'recategorizacion', 'ventana', 'exclusion', 'cuota', 'vencimiento', 'sync'],
  },
};
// La config del contador se guarda EN LA CUENTA (backend), no en localStorage. La carga/guardado
// vive en src/context/ConfigContext.tsx (useConfig). Acá quedan sólo los defaults.
