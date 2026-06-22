/**
 * Exporta el "papel de trabajo" del cliente a un archivo Excel (.xlsx) descargable.
 * Genera el libro en el navegador con SheetJS (xlsx, ya dependencia del proyecto). Una hoja por
 * bloque: Resumen, Historial 12m, Alertas, Movimientos pendientes y Acciones sugeridas.
 */
import * as XLSX from 'xlsx';
import type { Cliente, MovimientoBancario } from '@/types';
import type { CalculoCliente } from '@/lib/monotributo';
import type { Alerta, Severidad } from '@/lib/alertas';
import { ventana12Meses } from '@/lib/monotributo';
import { getCategoria } from '@/data/categorias';
import { esMonotributista, etiquetaRegimen } from '@/lib/regimen';
import { formatCuit } from '@/lib/utils';
import { accionesSugeridas, esPendienteRespaldo } from '@/lib/reporteCliente';

const SEV_LABEL: Record<Severidad, string> = {
  urgente: 'Urgente',
  aviso: 'Aviso',
  datos: 'Sin datos',
  ok: 'OK',
};

type Fila = (string | number)[];

export function descargarReporteExcel(opts: {
  cliente: Cliente;
  calc: CalculoCliente;
  alertas: Alerta[];
  movimientos: MovimientoBancario[];
}) {
  const { cliente, calc, alertas, movimientos } = opts;
  const mono = esMonotributista(cliente);
  const cat = getCategoria(cliente.categoria);
  const pendientes = movimientos.filter(esPendienteRespaldo);

  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen ──────────────────────────────────────────────
  const cuota =
    cliente.proxVencImporte ??
    (cliente.tipoActividad === 'servicios' ? cat.cuotaServicios : cat.cuotaComercio);
  const resumen: Fila[] = [
    ['Reporte de situación', mono ? 'Monotributo' : 'Fiscal'],
    ['Generado', new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })],
    [],
    ['Cliente', cliente.nombre],
    ['CUIT', formatCuit(cliente.cuit)],
    ['Régimen', etiquetaRegimen(cliente.regimen)],
    ['Actividad', cliente.tipoActividad],
  ];
  if (mono) {
    resumen.push(['Categoría actual', `Cat. ${cliente.categoria ?? '—'}`]);
    resumen.push([]);
    resumen.push(['Facturación últimos 12 meses', calc.facturacionUltimos12]);
    resumen.push(['Tope de la categoría', calc.topeReferencia]);
    resumen.push(['Tope consumido', `${(calc.porcentajeTopeActual * 100).toFixed(1)}%`]);
    resumen.push(['Categoría que corresponde', `Cat. ${calc.categoriaCorresponde.codigo}`]);
    resumen.push(['Cuota del mes', cuota]);
    resumen.push(['Estado de la cuota', cliente.estadoCuotaMesActual === 'con-deuda' ? 'Con deuda' : 'Al día']);
    resumen.push(['Deuda de cuota', cliente.cuotaDeuda ?? 0]);
    resumen.push(['Saldo a favor', cliente.cuotaSaldoFavor ?? 0]);
    resumen.push(['Próximo vencimiento', cliente.proxVencFecha ?? '—']);
    if (calc.proximaVentana) {
      resumen.push([
        'Próxima ventana de recategorización',
        `${calc.proximaVentana.fechaLimite} (semestre ${calc.proximaVentana.semestre})`,
      ]);
    }
  } else {
    resumen.push([]);
    resumen.push(['Facturación últimos 12 meses', calc.facturacionUltimos12]);
  }
  const wsR = XLSX.utils.aoa_to_sheet(resumen);
  wsR['!cols'] = [{ wch: 36 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

  // ── Hoja 2: Historial 12 meses ───────────────────────────────────
  const ult12 = ventana12Meses(cliente.historialMensual);
  if (ult12.length > 0) {
    const hist: Fila[] = [['Mes', 'Ventas netas', 'Compras']];
    [...ult12].reverse().forEach(m => hist.push([m.mes, m.emitidasNetas, m.recibidas]));
    const wsH = XLSX.utils.aoa_to_sheet(hist);
    wsH['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsH, 'Historial 12m');
  }

  // ── Hoja 3: Alertas ──────────────────────────────────────────────
  const al: Fila[] = [['Severidad', 'Tipo', 'Título', 'Detalle']];
  if (alertas.length === 0) {
    al.push(['—', '—', 'Sin alertas', 'El cliente no tiene alertas activas.']);
  } else {
    alertas.forEach(a => al.push([SEV_LABEL[a.severidad], a.tipo, a.titulo, a.detalle]));
  }
  const wsA = XLSX.utils.aoa_to_sheet(al);
  wsA['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 34 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, wsA, 'Alertas');

  // ── Hoja 4: Movimientos pendientes de respaldo ───────────────────
  const mov: Fila[] = [['Fecha', 'Fuente', 'Originante', 'CUIT', 'Monto']];
  if (pendientes.length === 0) {
    mov.push(['—', '—', 'Sin movimientos pendientes de respaldo', '', '']);
  } else {
    pendientes.forEach(m =>
      mov.push([
        m.fecha,
        m.fuente,
        m.nombreOriginante || m.descripcion || '—',
        m.cuitOriginante ? formatCuit(m.cuitOriginante) : '',
        m.monto,
      ]),
    );
  }
  const wsM = XLSX.utils.aoa_to_sheet(mov);
  wsM['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 34 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsM, 'Movimientos pendientes');

  // ── Hoja 5: Acciones sugeridas ───────────────────────────────────
  const acc = accionesSugeridas(cliente, calc, alertas, pendientes.length);
  const wsAcc = XLSX.utils.aoa_to_sheet([['Acciones sugeridas'], ...acc.map(a => [a])]);
  wsAcc['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsAcc, 'Acciones sugeridas');

  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = cliente.nombre.replace(/[\\/:*?"<>|]/g, '').slice(0, 60).trim() || cliente.cuit;
  XLSX.writeFile(wb, `Reporte ${nombre} ${fecha}.xlsx`);
}
