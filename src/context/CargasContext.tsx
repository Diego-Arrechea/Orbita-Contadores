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

interface CargasContextValue {
  cargas: CargaJob[];
  activas: CargaJob[];
  /** Incrementa cada vez que una carga termina: úsalo como dep para refrescar la cartera. */
  version: number;
  registrarCarga: (jobId: string, clientes: CargaCliente[]) => void;
  descartar: (jobId: string) => void;
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
  // Jobs cuyos efectos de finalización ya corrieron (no re-disparar al restaurar / re-pollear).
  const procesados = useRef<Set<string>>(new Set());
  const fallos = useRef<Record<string, number>>({});

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
        setCargas(prev =>
          prev.map(c =>
            c.jobId === jobId
              ? { ...c, estado: p.estado, progreso: p.progreso, mensaje: p.mensaje, resultados: p.resultados, error: p.error }
              : c,
          ),
        );
        if ((p.estado === 'terminado' || p.estado === 'error') && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setVersion(v => v + 1);
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
  }, [claveActivas]);

  return (
    <CargasContext.Provider value={{ cargas, activas, version, registrarCarga, descartar }}>
      {children}
    </CargasContext.Provider>
  );
}

export function useCargas(): CargasContextValue {
  const ctx = useContext(CargasContext);
  if (!ctx) throw new Error('useCargas debe usarse dentro de <CargasProvider>');
  return ctx;
}
