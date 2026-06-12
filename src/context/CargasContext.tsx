/**
 * Seguimiento GLOBAL de las cargas de clientes (alta = traer comprobantes de ARCA).
 *
 * El backend ya hace el trabajo en segundo plano (devuelve un job_id y se poolea su progreso); el
 * problema era que el seguimiento vivía en el estado de la página de alta y se perdía al navegar.
 * Acá lo subimos por encima del router: el polling y los efectos de finalización corren así el
 * contador se vaya al dashboard. Sobrevive incluso a un refresh del browser (persistencia en LS).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getProgresoMonitoreo, type JobProgreso } from '@/services/onboardingService';
import { ApiError } from '@/services/apiClient';

export interface CargaCliente {
  cuit: string;
  nombre: string;
}

export interface CargaJob {
  jobId: string;
  clientes: CargaCliente[];
  titulo: string;
  estado: JobProgreso['estado']; // en_proceso | terminado | error
  progreso: number;
  mensaje: string;
  resultados: JobProgreso['resultados'];
  error: string | null;
  iniciadoEn: number;
}

/** Aviso transitorio (toast) que aparece cuando una carga termina y se va solo a los 5 s. */
export interface AvisoCarga {
  id: string;
  titulo: string;
  tipo: 'ok' | 'error';
  mensaje: string;
}

interface CargasContextValue {
  cargas: CargaJob[];
  activas: CargaJob[];
  /** Avisos transitorios pendientes de mostrar (se autodescartan a los 5 s). */
  avisos: AvisoCarga[];
  /** Incrementa cada vez que una carga termina: úsalo como dep para refrescar la cartera. */
  version: number;
  registrarCarga: (jobId: string, clientes: CargaCliente[]) => void;
  descartar: (jobId: string) => void;
  descartarAviso: (id: string) => void;
}

const CargasContext = createContext<CargasContextValue | null>(null);

const LS_KEY = 'orbita_cargas';
const MAX_FALLOS = 4; // tras N polls fallidos TRANSITORIOS seguidos, se marca la carga en error
const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000; // un alta tarda minutos; > 1h en_proceso = job muerto

function tituloDe(clientes: CargaCliente[]): string {
  if (clientes.length === 1) return clientes[0].nombre;
  return `${clientes.length} clientes`;
}

const AVISO_MS = 5000; // el aviso de "carga lista" se va solo a los 5 s

/** Arma el aviso transitorio a partir del resultado final de la carga (copy de dominio). */
function avisoDeCarga(c: CargaJob): AvisoCarga {
  const ok = c.resultados.filter(r => r.ok).length;
  const fallaron = c.resultados.filter(r => !r.ok).length;
  // Falló del todo (error de job, o ningún cliente quedó conectado).
  if (c.estado === 'error' || (ok === 0 && fallaron > 0)) {
    return { id: c.jobId, titulo: c.titulo, tipo: 'error', mensaje: 'No se pudo completar la carga.' };
  }
  const mensaje = fallaron
    ? `Datos al día. ${fallaron} con error.`
    : 'Comprobantes y datos al día.';
  return { id: c.jobId, titulo: c.titulo, tipo: 'ok', mensaje };
}

function cargarLS(): CargaJob[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as CargaJob[];
    if (!Array.isArray(arr)) return [];
    const ahora = Date.now();
    return arr.filter(c => {
      const edad = ahora - (c.iniciadoEn || 0);
      // en_proceso viejo (> 1h) = job muerto (el backend perdió su registro en memoria, p. ej. al
      // reiniciarse) o un fantasma de LS → no lo restauramos. Terminadas/error: se guardan 1 día.
      return c.estado === 'en_proceso' ? edad < HORA_MS : edad < DIA_MS;
    });
  } catch {
    return [];
  }
}

function guardarLS(cargas: CargaJob[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cargas));
  } catch {
    /* ignore */
  }
}

export function CargasProvider({ children }: { children: ReactNode }) {
  const [cargas, setCargas] = useState<CargaJob[]>(() => cargarLS());
  const [version, setVersion] = useState(0);
  const [avisos, setAvisos] = useState<AvisoCarga[]>([]);
  // Jobs cuyos efectos de finalización ya corrieron (no re-disparar al restaurar / re-pollear).
  const procesados = useRef<Set<string>>(new Set());
  const fallos = useRef<Record<string, number>>({});

  const descartarAviso = useCallback((id: string) => {
    setAvisos(prev => prev.filter(a => a.id !== id));
  }, []);

  // Encola un aviso transitorio y lo quita solo a los AVISO_MS.
  const emitirAviso = useCallback(
    (aviso: AvisoCarga) => {
      setAvisos(prev => [...prev.filter(a => a.id !== aviso.id), aviso]);
      setTimeout(() => descartarAviso(aviso.id), AVISO_MS);
    },
    [descartarAviso],
  );

  // Seedea `procesados` con las cargas ya terminadas que se restauraron de LS (una sola vez).
  useEffect(() => {
    cargas.forEach(c => {
      if (c.estado !== 'en_proceso') procesados.current.add(c.jobId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    guardarLS(cargas);
  }, [cargas]);

  const registrarCarga = useCallback((jobId: string, clientes: CargaCliente[]) => {
    setCargas(prev =>
      prev.some(c => c.jobId === jobId)
        ? prev
        : [
            {
              jobId,
              clientes,
              titulo: tituloDe(clientes),
              estado: 'en_proceso',
              progreso: 0,
              mensaje: 'Iniciando…',
              resultados: [],
              error: null,
              iniciadoEn: Date.now(),
            },
            ...prev,
          ],
    );
  }, []);

  const descartar = useCallback((jobId: string) => {
    setCargas(prev => prev.filter(c => c.jobId !== jobId));
  }, []);

  const activas = cargas.filter(c => c.estado === 'en_proceso');

  // Polling global: corre mientras haya cargas activas. El string de ids reinicia el efecto sólo
  // cuando cambia el CONJUNTO de activas (no en cada avance de %), así el intervalo es estable.
  const claveActivas = activas.map(c => c.jobId).join(',');
  useEffect(() => {
    if (!claveActivas) return;
    const ids = claveActivas.split(',');
    let cancel = false;

    const pollOne = async (jobId: string) => {
      try {
        const p = await getProgresoMonitoreo(jobId);
        if (cancel) return;
        fallos.current[jobId] = 0;
        let cargaFinal: CargaJob | null = null;
        setCargas(prev =>
          prev.map(c => {
            if (c.jobId !== jobId) return c;
            const upd = { ...c, estado: p.estado, progreso: p.progreso, mensaje: p.mensaje, resultados: p.resultados, error: p.error };
            cargaFinal = upd;
            return upd;
          }),
        );
        if ((p.estado === 'terminado' || p.estado === 'error') && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setVersion(v => v + 1);
          if (cargaFinal) emitirAviso(avisoDeCarga(cargaFinal));
        }
      } catch (e) {
        if (cancel) return;
        // 404 = el job ya no existe en el backend (se reinició y perdió el registro en memoria, o es
        // un fantasma de localStorage como "demo-activo"). Es PERMANENTE → descartamos la carga (no
        // reintentamos ni la dejamos en LS), así no spammea 404 en cada poll y no vuelve al recargar.
        if (e instanceof ApiError && e.status === 404) {
          procesados.current.add(jobId);
          setCargas(prev => prev.filter(c => c.jobId !== jobId));
          return;
        }
        fallos.current[jobId] = (fallos.current[jobId] ?? 0) + 1;
        if (fallos.current[jobId] >= MAX_FALLOS && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setCargas(prev =>
            prev.map(c =>
              c.jobId === jobId ? { ...c, estado: 'error', error: 'No se pudo seguir la carga.' } : c,
            ),
          );
        }
      }
    };

    const tick = () => ids.forEach(pollOne);
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      cancel = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveActivas]);

  return (
    <CargasContext.Provider
      value={{ cargas, activas, avisos, version, registrarCarga, descartar, descartarAviso }}
    >
      {children}
    </CargasContext.Provider>
  );
}

export function useCargas(): CargasContextValue {
  const ctx = useContext(CargasContext);
  if (!ctx) throw new Error('useCargas debe usarse dentro de <CargasProvider>');
  return ctx;
}
