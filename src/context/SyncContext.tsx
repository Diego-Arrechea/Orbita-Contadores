/**
 * Seguimiento GLOBAL de las sincronizaciones de clientes (botón "Sincronizar ahora").
 *
 * La sincronización corre como un JOB en el backend (thread + job_id), así sigue aunque el contador
 * se vaya de la ficha O recargue la página. Acá la seguimos por encima del router: persistimos los
 * job_id en localStorage y los re-pooleamos al montar. Varias a la vez no chocan (cada scrape usa su
 * propio perfil en el backend). Mismo patrón que CargasContext (altas).
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
import {
  sincronizarCliente,
  sincronizarTodosClientes,
  getProgresoSincronizacion,
} from '@/services/comprobantesService';
import type { JobProgreso } from '@/services/onboardingService';
import { ApiError } from '@/services/apiClient';

export interface SyncJob {
  jobId: string; // '' mientras el POST que lo crea está en vuelo
  cuit: string;
  nombre: string;
  estado: 'en_proceso' | 'terminado' | 'error';
  progreso: number;
  mensaje: string;
  error: string | null;
  iniciadoEn: number;
  /** Comprobantes NUEVOS traídos en esta corrida (inserts; lo informa el job al terminar). */
  comprobantes?: number;
}

/** Job único de "sincronizar toda la cartera" (secuencial en el backend). */
export interface SyncTodosJob {
  jobId: string; // '' mientras el POST que lo crea está en vuelo
  estado: 'en_proceso' | 'terminado' | 'error';
  progreso: number;
  mensaje: string;
  total: number; // clientes a sincronizar (lo informa el POST)
  hechos: number; // clientes ya procesados (= resultados.length del job)
  ok: number;
  fallaron: number;
  /** Detalle por cliente ya procesado (nombre, ok/error, comprobantes nuevos). */
  resultados: JobProgreso['resultados'];
  error: string | null;
  iniciadoEn: number;
  /** Timestamp en que terminó (terminado/error); undefined mientras corre. Para mostrar cuánto tardó. */
  finalizadoEn?: number;
}

interface SyncContextValue {
  syncs: SyncJob[];
  activas: SyncJob[];
  /** Incrementa al terminar una sincronización: úsalo como dep para refrescar la cartera/ficha. */
  version: number;
  sincronizar: (cuit: string, nombre: string) => void;
  estaSincronizando: (cuit: string) => boolean;
  descartar: (cuit: string) => void;
  /** Sincronización de TODA la cartera (un único job secuencial). */
  todos: SyncTodosJob | null;
  sincronizarTodos: () => void;
  descartarTodos: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const LS_KEY = 'orbita_sincronizaciones';
const LS_KEY_TODOS = 'orbita_sync_todos';
const MAX_FALLOS = 4; // tras N polls fallidos TRANSITORIOS seguidos, se marca en error
const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000; // un sync tarda minutos; > 1h en_proceso = job muerto
const soloDigitos = (cuit: string) => cuit.replace(/\D/g, '');

function cargarLS(): SyncJob[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as SyncJob[];
    if (!Array.isArray(arr)) return [];
    const ahora = Date.now();
    return arr.filter(s => {
      const edad = ahora - (s.iniciadoEn || 0);
      // en_proceso viejo (> 1h) = job muerto (backend reiniciado / fantasma); sin jobId = nunca arrancó.
      if (s.estado === 'en_proceso') return !!s.jobId && edad < HORA_MS;
      return edad < DIA_MS; // terminadas/error: se conservan 1 día
    });
  } catch {
    return [];
  }
}

function guardarLS(syncs: SyncJob[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(syncs));
  } catch {
    /* ignore */
  }
}

function cargarTodosLS(): SyncTodosJob | null {
  try {
    const raw = localStorage.getItem(LS_KEY_TODOS);
    if (!raw) return null;
    const j = JSON.parse(raw) as SyncTodosJob;
    const edad = Date.now() - (j.iniciadoEn || 0);
    // en_proceso viejo (> 1h) = job muerto; sin jobId = nunca arrancó. Terminados: 1 día.
    if (j.estado === 'en_proceso') return j.jobId && edad < HORA_MS ? j : null;
    return edad < DIA_MS ? j : null;
  } catch {
    return null;
  }
}

function guardarTodosLS(todos: SyncTodosJob | null): void {
  try {
    if (todos) localStorage.setItem(LS_KEY_TODOS, JSON.stringify(todos));
    else localStorage.removeItem(LS_KEY_TODOS);
  } catch {
    /* ignore */
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [syncs, setSyncs] = useState<SyncJob[]>(() => cargarLS());
  const [version, setVersion] = useState(0);
  const procesados = useRef<Set<string>>(new Set());
  const fallos = useRef<Record<string, number>>({});

  // Seedea `procesados` con las terminadas restauradas de LS (no re-disparar efectos al re-poolear).
  useEffect(() => {
    syncs.forEach(s => {
      if (s.estado !== 'en_proceso') procesados.current.add(s.jobId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    guardarLS(syncs);
  }, [syncs]);

  const sincronizar = useCallback(
    (cuit: string, nombre: string) => {
      const id = soloDigitos(cuit);
      if (syncs.some(s => s.cuit === id && s.estado === 'en_proceso')) return; // ya está corriendo
      const placeholder: SyncJob = {
        jobId: '',
        cuit: id,
        nombre,
        estado: 'en_proceso',
        progreso: 0,
        mensaje: 'Iniciando…',
        error: null,
        iniciadoEn: Date.now(),
      };
      setSyncs(prev => [placeholder, ...prev.filter(s => s.cuit !== id)]);
      sincronizarCliente(id)
        .then(({ job_id }) =>
          setSyncs(cur =>
            cur.map(s => (s.cuit === id && s.jobId === '' ? { ...s, jobId: job_id } : s)),
          ),
        )
        .catch((e: unknown) =>
          setSyncs(cur =>
            cur.map(s =>
              s.cuit === id && s.jobId === ''
                ? {
                    ...s,
                    estado: 'error',
                    error: e instanceof Error ? e.message : 'No se pudo iniciar la sincronización',
                  }
                : s,
            ),
          ),
        );
    },
    [syncs],
  );

  const estaSincronizando = useCallback(
    (cuit: string) => syncs.some(s => s.cuit === soloDigitos(cuit) && s.estado === 'en_proceso'),
    [syncs],
  );

  const descartar = useCallback((cuit: string) => {
    setSyncs(prev => prev.filter(s => s.cuit !== soloDigitos(cuit)));
  }, []);

  const activas = syncs.filter(s => s.estado === 'en_proceso');

  // Polling global de las sincronizaciones con job_id (las que ya arrancaron en el backend).
  const claveActivas = syncs
    .filter(s => s.estado === 'en_proceso' && s.jobId)
    .map(s => s.jobId)
    .join(',');
  useEffect(() => {
    if (!claveActivas) return;
    const ids = claveActivas.split(',');
    let cancel = false;

    const pollOne = async (jobId: string) => {
      try {
        const p = await getProgresoSincronizacion(jobId);
        if (cancel) return;
        fallos.current[jobId] = 0;
        const comprobantes = p.resultados.find(r => r.cuit)?.comprobantes;
        setSyncs(prev =>
          prev.map(s =>
            s.jobId === jobId
              ? {
                  ...s,
                  estado: p.estado,
                  progreso: p.progreso,
                  mensaje: p.mensaje,
                  error: p.error,
                  comprobantes: comprobantes ?? s.comprobantes,
                }
              : s,
          ),
        );
        if ((p.estado === 'terminado' || p.estado === 'error') && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setVersion(v => v + 1);
        }
      } catch (e) {
        if (cancel) return;
        // 404 = el job ya no existe (backend reiniciado / fantasma): permanente → descartar.
        if (e instanceof ApiError && e.status === 404) {
          procesados.current.add(jobId);
          setSyncs(prev => prev.filter(s => s.jobId !== jobId));
          return;
        }
        fallos.current[jobId] = (fallos.current[jobId] ?? 0) + 1;
        if (fallos.current[jobId] >= MAX_FALLOS && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setSyncs(prev =>
            prev.map(s =>
              s.jobId === jobId
                ? { ...s, estado: 'error', error: 'No se pudo seguir la sincronización.' }
                : s,
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

  // ─── Sincronización de TODA la cartera (un único job secuencial en el backend) ───
  const [todos, setTodos] = useState<SyncTodosJob | null>(() => cargarTodosLS());
  const todosProcesado = useRef(false);

  useEffect(() => {
    guardarTodosLS(todos);
  }, [todos]);

  const sincronizarTodos = useCallback(() => {
    setTodos(cur => {
      if (cur?.estado === 'en_proceso') return cur; // ya está corriendo
      todosProcesado.current = false;
      return {
        jobId: '',
        estado: 'en_proceso',
        progreso: 0,
        mensaje: 'Iniciando…',
        total: 0,
        hechos: 0,
        ok: 0,
        fallaron: 0,
        resultados: [],
        error: null,
        iniciadoEn: Date.now(),
      };
    });
    sincronizarTodosClientes()
      .then(({ job_id, total }) =>
        setTodos(cur => (cur && cur.jobId === '' ? { ...cur, jobId: job_id, total } : cur)),
      )
      .catch((e: unknown) =>
        setTodos(cur =>
          cur && cur.jobId === ''
            ? {
                ...cur,
                estado: 'error',
                error: e instanceof Error ? e.message : 'No se pudo iniciar la sincronización',
              }
            : cur,
        ),
      );
  }, []);

  const descartarTodos = useCallback(() => setTodos(null), []);

  // Polling del job "todos" mientras está en proceso (reusa el endpoint de sincronizaciones).
  const todosJobId = todos?.estado === 'en_proceso' ? todos.jobId : '';
  useEffect(() => {
    if (!todosJobId) return;
    let cancel = false;
    const tick = async () => {
      try {
        const p = await getProgresoSincronizacion(todosJobId);
        if (cancel) return;
        const ok = p.resultados.filter(r => r.ok).length;
        const fallaron = p.resultados.filter(r => !r.ok).length;
        const termino = p.estado === 'terminado' || p.estado === 'error';
        setTodos(cur =>
          cur && cur.jobId === todosJobId
            ? {
                ...cur,
                estado: p.estado,
                progreso: p.progreso,
                mensaje: p.mensaje,
                hechos: p.resultados.length,
                ok,
                fallaron,
                resultados: p.resultados,
                error: p.error,
                // Sellamos la hora de fin una sola vez (idempotente entre ticks).
                finalizadoEn: termino ? (cur.finalizadoEn ?? Date.now()) : cur.finalizadoEn,
              }
            : cur,
        );
        if ((p.estado === 'terminado' || p.estado === 'error') && !todosProcesado.current) {
          todosProcesado.current = true;
          setVersion(v => v + 1); // refresca cartera/última-sincronización
        }
      } catch (e) {
        if (cancel) return;
        // 404 = job muerto (backend reiniciado/fantasma): descartar.
        if (e instanceof ApiError && e.status === 404) setTodos(null);
      }
    };
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [todosJobId]);

  return (
    <SyncContext.Provider
      value={{
        syncs,
        activas,
        version,
        sincronizar,
        estaSincronizando,
        descartar,
        todos,
        sincronizarTodos,
        descartarTodos,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>');
  return ctx;
}
