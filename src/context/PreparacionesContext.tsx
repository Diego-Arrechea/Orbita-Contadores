/**
 * Seguimiento GLOBAL de las habilitaciones de facturación en segundo plano (el backend genera el
 * certificado + adhiere el servicio + crea el punto de venta en un job; acá seguimos su progreso por
 * encima del router). Así el contador puede CERRAR el diálogo de habilitación y seguir trabajando:
 * el seguimiento vive acá, no en el diálogo. Cuando termina, refresca la ficha del cliente (el botón
 * pasa de "Habilitar facturación" a "Emitir comprobante"). Sobrevive a un refresh (persistencia en
 * localStorage), igual que las cargas de clientes (CargasContext). Es un context SEPARADO a propósito
 * (no toca el del alta, que es crítico).
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
import { progresoPreparacion, type JobProgreso } from '@/services/facturacionService';
import { ApiError } from '@/services/apiClient';
import { qkClientes } from '@/lib/queries';

export interface PrepFactura {
  jobId: string;
  cuit: string;
  nombre: string;
  estado: JobProgreso['estado']; // en_proceso | terminado | error
  progreso: number;
  mensaje: string;
  error: string | null;
  iniciadoEn: number;
}

interface PreparacionesContextValue {
  preparaciones: PrepFactura[];
  activas: PrepFactura[];
  /** Toma el seguimiento de un job (el diálogo se cerró y sigue en segundo plano). */
  registrar: (jobId: string, cuit: string, nombre: string, progreso?: number, mensaje?: string) => void;
  descartar: (jobId: string) => void;
}

const PreparacionesContext = createContext<PreparacionesContextValue | null>(null);

const LS_KEY = 'orbita_facturacion_prep';
const MAX_FALLOS = 4; // tras N polls fallidos TRANSITORIOS seguidos, se marca en error
const DIA_MS = 24 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000; // la habilitación tarda ~1 min; > 1h en_proceso = job muerto

function cargarLS(): PrepFactura[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]') as PrepFactura[];
    if (!Array.isArray(arr)) return [];
    const ahora = Date.now();
    return arr.filter(p => {
      const edad = ahora - (p.iniciadoEn || 0);
      return p.estado === 'en_proceso' ? edad < HORA_MS : edad < DIA_MS;
    });
  } catch {
    return [];
  }
}

function guardarLS(p: PrepFactura[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function PreparacionesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [preparaciones, setPreparaciones] = useState<PrepFactura[]>(() => cargarLS());
  // Espejo para leer cuit/estado desde el poll sin recrear el intervalo en cada avance.
  const prepsRef = useRef(preparaciones);
  prepsRef.current = preparaciones;
  // Jobs cuyo efecto de finalización ya corrió (no re-disparar al restaurar / re-pollear).
  const procesados = useRef<Set<string>>(new Set());
  const fallos = useRef<Record<string, number>>({});

  // Seedea `procesados` con las que se restauraron ya terminadas de LS (una sola vez).
  useEffect(() => {
    preparaciones.forEach(p => {
      if (p.estado !== 'en_proceso') procesados.current.add(p.jobId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    guardarLS(preparaciones);
  }, [preparaciones]);

  const registrar = useCallback(
    (jobId: string, cuit: string, nombre: string, progreso = 0, mensaje = 'Habilitando…') => {
      setPreparaciones(prev =>
        prev.some(p => p.jobId === jobId)
          ? prev
          : [
              { jobId, cuit, nombre, estado: 'en_proceso', progreso, mensaje, error: null, iniciadoEn: Date.now() },
              ...prev,
            ],
      );
    },
    [],
  );

  const descartar = useCallback((jobId: string) => {
    setPreparaciones(prev => prev.filter(p => p.jobId !== jobId));
  }, []);

  const activas = preparaciones.filter(p => p.estado === 'en_proceso');

  // Polling global: corre mientras haya habilitaciones activas. El conjunto de ids reinicia el
  // efecto sólo cuando cambia (no en cada avance de %), así el intervalo es estable.
  const claveActivas = activas.map(p => p.jobId).join(',');
  useEffect(() => {
    if (!claveActivas) return;
    const ids = claveActivas.split(',');
    let cancel = false;

    const pollOne = async (jobId: string) => {
      const job = prepsRef.current.find(p => p.jobId === jobId);
      if (!job) return;
      try {
        const p = await progresoPreparacion(job.cuit, jobId);
        if (cancel) return;
        fallos.current[jobId] = 0;
        setPreparaciones(prev =>
          prev.map(x =>
            x.jobId === jobId
              ? { ...x, estado: p.estado, progreso: p.progreso, mensaje: p.mensaje, error: p.error ?? null }
              : x,
          ),
        );
        if ((p.estado === 'terminado' || p.estado === 'error') && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          if (p.estado === 'terminado') {
            // Refresca la ficha (el botón pasa de "Habilitar" a "Emitir") y la cartera. La key
            // parcial ['cliente'] matchea cualquier qkCliente(*) montada.
            void qc.invalidateQueries({ queryKey: ['cliente'] });
            void qc.invalidateQueries({ queryKey: qkClientes });
          }
        }
      } catch (e) {
        if (cancel) return;
        // 404 = el backend ya no tiene el job (se reinició y perdió el registro en memoria). Es
        // PERMANENTE → lo descartamos (no spammea 404 ni vuelve al recargar).
        if (e instanceof ApiError && e.status === 404) {
          procesados.current.add(jobId);
          setPreparaciones(prev => prev.filter(x => x.jobId !== jobId));
          return;
        }
        fallos.current[jobId] = (fallos.current[jobId] ?? 0) + 1;
        if (fallos.current[jobId] >= MAX_FALLOS && !procesados.current.has(jobId)) {
          procesados.current.add(jobId);
          setPreparaciones(prev =>
            prev.map(x =>
              x.jobId === jobId ? { ...x, estado: 'error', error: 'No se pudo seguir la habilitación.' } : x,
            ),
          );
        }
      }
    };

    const tick = () => ids.forEach(pollOne);
    const id = setInterval(tick, 2500);
    tick();
    return () => {
      cancel = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveActivas, qc]);

  return (
    <PreparacionesContext.Provider value={{ preparaciones, activas, registrar, descartar }}>
      {children}
    </PreparacionesContext.Provider>
  );
}

export function usePreparaciones(): PreparacionesContextValue {
  const ctx = useContext(PreparacionesContext);
  if (!ctx) throw new Error('usePreparaciones debe usarse dentro de <PreparacionesProvider>');
  return ctx;
}
