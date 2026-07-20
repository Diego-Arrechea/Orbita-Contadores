/**
 * Seguimiento GLOBAL de las re-sincronizaciones MANUALES (el botón "Actualizar" de cada cliente en
 * la lista). Distinto de CargasContext (que es el ALTA de clientes nuevos): acá el cliente YA existe,
 * no se puede cancelar-borrar y no se reemplaza su fila por una caja de progreso — sólo mostramos un
 * spinner en el botón y, al terminar, refrescamos la cartera y avisamos.
 *
 * El backend hace el trabajo en segundo plano (POST /clientes/{cuit}/sincronizar → job_id, que se
 * poolea con GET /sincronizaciones/{job_id}). Este provider vive por encima del router, así el
 * seguimiento sobrevive a que el contador navegue entre el dashboard y la ficha.
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
import { useQueryClient } from '@tanstack/react-query';
import { getProgresoSync, sincronizarClienteManual } from '@/services/clientesService';
import type { JobProgreso } from '@/services/onboardingService';
import { ApiError } from '@/services/apiClient';
import { formatCuit } from '@/lib/utils';
import { qkClientes } from '@/lib/queries';

interface SyncEnCurso {
  cuit: string; // sólo dígitos
  nombre: string;
  jobId: string;
  estado: JobProgreso['estado'];
  iniciadoEn: number;
}

/** Aviso transitorio (toast) que aparece cuando una re-sync termina y se va solo a los 5 s. */
export interface AvisoSync {
  id: string;
  titulo: string;
  tipo: 'ok' | 'error';
  mensaje: string;
}

interface SyncManualContextValue {
  /** Dispara la re-sync de un cliente (no-op si ya tiene una en curso). */
  sincronizar: (cuit: string, nombre: string) => void;
  /** ¿Este cliente tiene una re-sync manual en curso? (para el spinner del botón). */
  estaSincronizando: (cuit: string) => boolean;
  avisos: AvisoSync[];
  descartarAviso: (id: string) => void;
}

const SyncManualContext = createContext<SyncManualContextValue | null>(null);

const AVISO_MS = 5000;

function tituloDe(s: SyncEnCurso): string {
  return s.nombre || `CUIT ${formatCuit(s.cuit)}`;
}

export function SyncManualProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Re-syncs en curso, indexadas por CUIT (sólo dígitos).
  const [enCurso, setEnCurso] = useState<Record<string, SyncEnCurso>>({});
  const [avisos, setAvisos] = useState<AvisoSync[]>([]);
  const fallos = useRef<Record<string, number>>({});

  const descartarAviso = useCallback((id: string) => {
    setAvisos(prev => prev.filter(a => a.id !== id));
  }, []);

  const emitirAviso = useCallback(
    (aviso: AvisoSync) => {
      setAvisos(prev => [...prev.filter(a => a.id !== aviso.id), aviso]);
      setTimeout(() => descartarAviso(aviso.id), AVISO_MS);
    },
    [descartarAviso],
  );

  const sincronizar = useCallback(
    (cuit: string, nombre: string) => {
      const limpio = (cuit ?? '').replace(/\D/g, '');
      if (!limpio) return;
      // Ya hay una re-sync en curso para este cliente → no dupliques.
      let yaEsta = false;
      setEnCurso(prev => {
        if (prev[limpio]) {
          yaEsta = true;
          return prev;
        }
        return { ...prev, [limpio]: { cuit: limpio, nombre, jobId: '', estado: 'en_proceso', iniciadoEn: Date.now() } };
      });
      if (yaEsta) return;

      sincronizarClienteManual(limpio)
        .then(({ job_id }) => {
          fallos.current[limpio] = 0;
          setEnCurso(prev => (prev[limpio] ? { ...prev, [limpio]: { ...prev[limpio], jobId: job_id } } : prev));
        })
        .catch(() => {
          // No se pudo ni arrancar: sacamos el spinner y avisamos.
          setEnCurso(prev => {
            const copia = { ...prev };
            delete copia[limpio];
            return copia;
          });
          emitirAviso({
            id: limpio,
            titulo: nombre || `CUIT ${formatCuit(limpio)}`,
            tipo: 'error',
            mensaje: 'No se pudo iniciar la actualización.',
          });
        });
    },
    [emitirAviso],
  );

  const estaSincronizando = useCallback(
    (cuit: string) => Boolean(enCurso[(cuit ?? '').replace(/\D/g, '')]),
    [enCurso],
  );

  // Polling global: corre mientras haya re-syncs con job_id asignado. La clave reinicia el efecto
  // sólo cuando cambia el CONJUNTO de jobs activos, no en cada avance.
  const claveActivas = Object.values(enCurso)
    .filter(s => s.jobId)
    .map(s => `${s.cuit}:${s.jobId}`)
    .join(',');

  useEffect(() => {
    if (!claveActivas) return;
    const pares = claveActivas.split(',').map(p => p.split(':') as [string, string]);
    let cancel = false;

    const finalizar = (cuit: string, s: SyncEnCurso, ok: boolean, comprobantes: number | null) => {
      setEnCurso(prev => {
        const copia = { ...prev };
        delete copia[cuit];
        return copia;
      });
      // Refresca la cartera para que se vean los datos nuevos del cliente.
      void qc.invalidateQueries({ queryKey: qkClientes });
      emitirAviso(
        ok
          ? {
              id: cuit,
              titulo: tituloDe(s),
              tipo: 'ok',
              mensaje:
                comprobantes && comprobantes > 0
                  ? `Datos al día · ${comprobantes} comprobante${comprobantes === 1 ? '' : 's'} nuevo${comprobantes === 1 ? '' : 's'}.`
                  : 'Datos al día.',
            }
          : { id: cuit, titulo: tituloDe(s), tipo: 'error', mensaje: 'No se pudo actualizar.' },
      );
    };

    const pollOne = async ([cuit, jobId]: [string, string]) => {
      const s = enCurso[cuit];
      if (!s) return;
      try {
        const p = await getProgresoSync(jobId);
        if (cancel) return;
        fallos.current[cuit] = 0;
        if (p.estado === 'terminado' || p.estado === 'error') {
          const comps = p.resultados?.find(r => (r.cuit ?? '').replace(/\D/g, '') === cuit)?.comprobantes ?? null;
          finalizar(cuit, s, p.estado === 'terminado', comps);
        }
      } catch (e) {
        if (cancel) return;
        // 404 = el backend perdió el registro del job (se reinició). Permanente → cerramos el spinner.
        if (e instanceof ApiError && e.status === 404) {
          finalizar(cuit, s, false, null);
          return;
        }
        fallos.current[cuit] = (fallos.current[cuit] ?? 0) + 1;
        if (fallos.current[cuit] >= 4) finalizar(cuit, s, false, null);
      }
    };

    const tick = () => pares.forEach(pollOne);
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      cancel = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveActivas]);

  return (
    <SyncManualContext.Provider value={{ sincronizar, estaSincronizando, avisos, descartarAviso }}>
      {children}
    </SyncManualContext.Provider>
  );
}

export function useSyncManual(): SyncManualContextValue {
  const ctx = useContext(SyncManualContext);
  if (!ctx) throw new Error('useSyncManual debe usarse dentro de <SyncManualProvider>');
  return ctx;
}
