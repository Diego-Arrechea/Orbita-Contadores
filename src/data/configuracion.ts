import type { Configuracion } from '@/types';
import { ventanasRecategorizacion } from '@/lib/recategorizacion';

export const CONFIGURACION_INICIAL: Configuracion = {
  // Ventanas de recategorización oficiales (vencen 5/8 y 5/2), generadas a partir de la fecha
  // actual para que nunca queden vencidas. Ver src/lib/recategorizacion.ts.
  ventanas: ventanasRecategorizacion(),
  // Inflación mensual para proyectar la facturación a 12 meses (compuesta). Por defecto la app usa la
  // inflación esperada del mercado (inflacionAuto = true); este valor MANUAL es el fallback / override
  // que el contador puede fijar. 0.02 = 2%/mes; 0 = sin inflación.
  inflacionMensualProyeccion: 0.02,
  inflacionAuto: true,
  // Criterio por tipo de alerta (umbral + re-aviso por subida). Reemplaza los umbrales globales.
  // Defaults equivalentes a los viejos umbrales. reavisarSubidaPct 0.10 = re-avisar al subir +10pp.
  // Estos defaults coinciden con ALERTAS_DEFAULT del backend (services/alertas.py): cambiá los dos.
  alertas: {
    tope: { activo: true, avisarPct: 0.80, proyeccionCruce: true, reavisarSubidaPct: 0.10 },
    recategorizacion: { activo: true },
    ventana: { activo: true, avisoDias: 45, urgenteDias: 15 },
    exclusion: { activo: true, avisarRatioPct: 0.70, reavisarSubidaPct: 0.10 },
    cuota: { activo: true, urgenteDesdePct: 0.10, reavisarSubidaPct: 0.10 },
    vencimiento: { activo: true, avisarDiasAntes: 7 },
    sync: { activo: true },
  },
  // Canal de WhatsApp: apagado por defecto (el contador lo activa). Ventana horaria 9–21.
  notificaciones: {
    activo: false,
    horaDesde: 9,
    horaHasta: 21,
  },
};
// La config del contador se guarda EN LA CUENTA (backend), no en localStorage. La carga/guardado
// vive en src/context/ConfigContext.tsx (useConfig). Acá quedan sólo los defaults.
