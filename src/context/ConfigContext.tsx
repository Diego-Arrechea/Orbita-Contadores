/**
 * Configuración del contador (ventanas de recategorización, umbrales, inflación) GUARDADA EN LA
 * CUENTA. Antes vivía en localStorage; ahora se trae del backend (GET /configuracion) al entrar y se
 * guarda con PUT, así sigue al contador entre dispositivos.
 *
 * Arranca con los DEFAULTS (CONFIGURACION_INICIAL + ventanas calculadas a hoy), así el primer render
 * nunca está vacío: cuando llega lo guardado del backend, se refina sin parpadeo. Guardar es
 * optimista (aplica local y luego PUT).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiGet, apiPut } from '@/services/apiClient';
import { CONFIGURACION_INICIAL } from '@/data/configuracion';
import { ventanasRecategorizacion } from '@/lib/recategorizacion';
import type { Configuracion, ConfigAlertas } from '@/types';

interface ConfigContextValue {
  config: Configuracion; // SIEMPRE presente (arranca en defaults)
  cargando: boolean; // true hasta resolver el primer GET
  guardarConfig: (parcial: Partial<Configuracion>) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/**
 * Config efectiva: defaults + lo guardado en la cuenta. Ignora campos null/undefined (el backend
 * devuelve null en lo que el contador nunca tocó). Las ventanas se recalculan a hoy salvo que el
 * contador las haya editado a mano (misma regla que la vieja cargarConfiguracion()).
 */
function combinar(guardado: Partial<Configuracion> | null | undefined): Configuracion {
  // `guardado` puede traer la forma NUEVA (alertas{}) o la VIEJA (umbral* sueltos + notificaciones.tipos).
  const g = (guardado ?? {}) as Record<string, unknown>;
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (v !== null && v !== undefined) limpio[k] = v;
  }

  // Criterio por tipo: arranca de los defaults y aplica (1) el mapeo de los umbrales VIEJOS si existen
  // (back-compat) y (2) lo guardado en la forma nueva (gana). Deep-merge por tipo para tolerar parciales.
  const I = CONFIGURACION_INICIAL.alertas;
  const num = (x: unknown, def: number) => (typeof x === 'number' ? x : def);
  const viejo = limpio as Record<string, number | undefined>;
  const guardadas = (limpio.alertas ?? {}) as Partial<ConfigAlertas>;
  const alertas: ConfigAlertas = {
    tope: { ...I.tope, avisarPct: num(viejo.umbralAmarilloPorcentaje, I.tope.avisarPct), ...(guardadas.tope ?? {}) },
    recategorizacion: { ...I.recategorizacion, ...(guardadas.recategorizacion ?? {}) },
    ventana: {
      ...I.ventana,
      avisoDias: num(viejo.umbralAmarilloDias, I.ventana.avisoDias),
      urgenteDias: num(viejo.umbralRojoDias, I.ventana.urgenteDias),
      ...(guardadas.ventana ?? {}),
    },
    exclusion: { ...I.exclusion, avisarRatioPct: num(viejo.umbralRatioGastosAmarillo, I.exclusion.avisarRatioPct), ...(guardadas.exclusion ?? {}) },
    cuota: { ...I.cuota, urgenteDesdePct: num(viejo.umbralDeudaCuotaUrgente, I.cuota.urgenteDesdePct), ...(guardadas.cuota ?? {}) },
    vencimiento: { ...I.vencimiento, ...(guardadas.vencimiento ?? {}) },
    sync: { ...I.sync, ...(guardadas.sync ?? {}) },
  };

  const nb = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
  const ng = (limpio.notificaciones ?? {}) as Record<string, unknown>;
  const N = CONFIGURACION_INICIAL.notificaciones;
  return {
    ...CONFIGURACION_INICIAL,
    inflacionMensualProyeccion: num(viejo.inflacionMensualProyeccion, CONFIGURACION_INICIAL.inflacionMensualProyeccion),
    ventanas: (limpio.ventanas as Configuracion['ventanas']) ?? ventanasRecategorizacion(),
    alertas,
    notificaciones: {
      activo: nb(ng.activo, N.activo),
      horaDesde: num(ng.horaDesde, N.horaDesde),
      horaHasta: num(ng.horaHasta, N.horaHasta),
    },
  };
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Configuracion>(() => combinar(null));
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    apiGet<Partial<Configuracion>>('/configuracion')
      .then(guardado => {
        if (vivo) setConfig(combinar(guardado));
      })
      .catch(() => {}) // backend caído → quedamos en defaults (degradación, como antes)
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const guardarConfig = useCallback(async (parcial: Partial<Configuracion>) => {
    setConfig(prev => ({ ...prev, ...parcial })); // optimista: la UI no espera el round-trip
    await apiPut('/configuracion', parcial); // si falla, propaga el error al caller (lo muestra)
  }, []);

  return (
    <ConfigContext.Provider value={{ config, cargando, guardarConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig debe usarse dentro de <ConfigProvider>');
  return ctx;
}
