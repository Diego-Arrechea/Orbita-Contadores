import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCargas } from '@/context/CargasContext';

/**
 * Cuando termina una carga (alta de cliente), el contexto sube su `version`. Acá lo escuchamos UNA
 * vez a nivel global e invalidamos las queries de clientes para que se re-traigan frescas. Reemplaza
 * el viejo patrón de poner `version` como dependencia del useEffect de fetch en cada página. No
 * renderiza nada.
 */
export function InvalidadorCache() {
  const qc = useQueryClient();
  const { version } = useCargas();
  const primero = useRef(true);

  useEffect(() => {
    if (primero.current) {
      primero.current = false; // en el montaje inicial no hay nada que invalidar
      return;
    }
    void qc.invalidateQueries({ queryKey: ['clientes'] });
    void qc.invalidateQueries({ queryKey: ['cliente'] });
  }, [version, qc]);

  return null;
}
