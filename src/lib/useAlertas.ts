/**
 * Hook compartido que arma las alertas de toda la cartera del contador. Es la única fuente de
 * verdad de alertas en la app: lo consumen tanto la página /alertas como la campanita del header,
 * así ambos muestran exactamente lo mismo. Se refresca al cambiar la config o al terminar una
 * sincronización (useSync().version).
 */
import { useEffect, useMemo, useState } from 'react';
import { CLIENTES } from '@/data/clientes';
import { useConfig } from '@/context/ConfigContext';
import { useSync } from '@/context/SyncContext';
import { calcularCliente } from '@/lib/monotributo';
import { derivarAlertas, ordenarPorSeveridad } from '@/lib/alertas';
import type { Alerta } from '@/lib/alertas';
import { getClientesReales } from '@/services/clientesService';
import { cuentaActual } from '@/lib/cuenta';
import type { Cliente } from '@/types';

export interface AlertasResult {
  alertas: Alerta[];
  conteo: { urgente: number; aviso: number; datos: number };
  cargando: boolean;
}

export function useAlertas(): AlertasResult {
  const [reales, setReales] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const cuenta = cuentaActual();
  const { config } = useConfig();
  const { version } = useSync();

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    getClientesReales()
      .then(cs => {
        if (vivo) setReales(cs);
      })
      .catch(() => {})
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
    // version: al terminar una sincronización, recargamos la cartera.
  }, [version]);

  const mock = cuenta?.datosEjemplo ? CLIENTES : [];

  const alertas = useMemo(() => {
    const todas: Alerta[] = [];
    for (const c of [...reales, ...mock]) {
      // el backend ya aplica las ediciones del contador
      const calc = calcularCliente(c, config.ventanas, config.inflacionMensualProyeccion);
      todas.push(...derivarAlertas(c, calc, config));
    }
    return ordenarPorSeveridad(todas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reales, cuenta?.datosEjemplo, config]);

  const conteo = useMemo(() => {
    const c = { urgente: 0, aviso: 0, datos: 0 };
    alertas.forEach(a => {
      if (a.severidad !== 'ok') c[a.severidad]++;
    });
    return c;
  }, [alertas]);

  return { alertas, conteo, cargando };
}
