import type { Comprobante, HistorialMes } from '@/types';

/**
 * Agrupa los comprobantes por mes para alimentar `calcularCliente`:
 *  - Emitidos (ventas): suma Facturas, resta Notas de Crédito → emitidasNetas (para el tope).
 *  - Recibidos (compras): suma Facturas, resta Notas de Crédito → recibidas (para el ratio de gastos).
 *
 * `recibidasComputables` = recibidas por ahora (todas las compras). Refinamiento futuro: marcar
 * rubros NO inherentes a la actividad para excluirlos de la causal de exclusión por gastos.
 */
export function derivarHistorial(comprobantes: Comprobante[]): HistorialMes[] {
  const porMes = new Map<
    string,
    { brutas: number; nc: number; recibidas: number; ncRecibidas: number }
  >();
  for (const c of comprobantes) {
    const mes = c.fechaEmision.slice(0, 7); // YYYY-MM
    const e = porMes.get(mes) ?? { brutas: 0, nc: 0, recibidas: 0, ncRecibidas: 0 };
    const esNC = c.tipo.includes('Nota Crédito');
    if (c.direccion === 'emitido') {
      if (esNC) e.nc += c.monto;
      else e.brutas += c.monto;
    } else if (c.direccion === 'recibido') {
      if (esNC) e.ncRecibidas += c.monto;
      else e.recibidas += c.monto;
    }
    porMes.set(mes, e);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b)) // cronológico (los últimos al final)
    .map(([mes, { brutas, nc, recibidas, ncRecibidas }]) => {
      const recibidasNetas = recibidas - ncRecibidas;
      return {
        mes,
        emitidasBrutas: brutas,
        notasCredito: nc,
        emitidasNetas: brutas - nc,
        recibidas: recibidasNetas,
        recibidasComputables: recibidasNetas,
        ingresosNoFacturados: 0,
      };
    });
}
