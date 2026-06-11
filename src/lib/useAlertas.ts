/**
 * Hook compartido que arma las alertas de toda la cartera del contador. Es la única fuente de
 * verdad de alertas en la app: lo consumen tanto la página /alertas como la campanita del header,
 * así ambos muestran exactamente lo mismo. Se refresca al cambiar la config o al terminar una
 * sincronización (useSync().version).
 */
import { useMemo } from 'react';
import { CLIENTES } from '@/data/clientes';
import { useConfig } from '@/context/ConfigContext';
import { calcularCliente } from '@/lib/monotributo';
import { derivarAlertas, ordenarPorSeveridad } from '@/lib/alertas';
import type { Alerta } from '@/lib/alertas';
import { useClientesReales } from '@/lib/queries';
import { cuentaActual } from '@/lib/cuenta';

export interface AlertasResult {
  alertas: Alerta[];
  conteo: { urgente: number; aviso: number; datos: number };
  cargando: boolean;
}

export function useAlertas(): AlertasResult {
  // Cartera cacheada y compartida con Dashboard/Conciliación; el InvalidadorCache global la re-trae
  // al terminar una sincronización (antes esto observaba useSync().version a mano).
  const { data: reales = [], isLoading: cargando } = useClientesReales();
  const cuenta = cuentaActual();
  const { config } = useConfig();

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
