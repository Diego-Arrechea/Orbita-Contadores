/**
 * Cuerpo del mail del reporte al cliente final: el mismo contenido que la pantalla del reporte
 * (`ReporteCliente`), en HTML de mail (tablas y estilos en línea, que es lo que respetan Gmail y
 * Outlook). El backend lo envuelve con el pie del estudio y lo envía (ver services/reporte_mail.py).
 * Todo texto variable pasa por `esc`: el cuerpo viaja como HTML.
 */
import { etiquetaRegimen } from '@/lib/regimen';
import { formatCuit, formatCurrency, formatDate } from '@/lib/utils';
import type { Cliente, ConfigReporte } from '@/types';
import type { DatosReporte } from '@/lib/reporteDatos';

const C = {
  tinta: '#1f2329',
  suave: '#6b7280',
  borde: '#e5e7eb',
  fondo: '#f8fafc',
  primario: '#2563eb',
  aviso: '#fef3c7',
  avisoBorde: '#f59e0b',
};

const SEV: Record<string, string> = {
  urgente: '#dc2626',
  aviso: '#f59e0b',
  datos: '#9ca3af',
  ok: '#16a34a',
};

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mesLegible(mes: string): string {
  const [y, m] = mes.split('-');
  return m && y ? `${m}/${y}` : mes;
}

const h2 = (t: string) =>
  `<h2 style="margin:28px 0 10px;font-size:16px;font-weight:bold;color:${C.tinta};">${esc(t)}</h2>`;

const p = (t: string, color = C.suave) =>
  `<p style="margin:6px 0;font-size:14px;line-height:1.5;color:${color};">${t}</p>`;

function tabla(cabecera: { t: string; der?: boolean }[], filas: string[][]): string {
  const th = cabecera
    .map(
      c =>
        `<th style="padding:8px 6px;border-bottom:1px solid ${C.borde};font-size:12px;font-weight:normal;color:${C.suave};text-align:${c.der ? 'right' : 'left'};">${esc(c.t)}</th>`,
    )
    .join('');
  const tr = filas
    .map(
      f =>
        `<tr>${f
          .map(
            (v, i) =>
              `<td style="padding:7px 6px;border-bottom:1px solid ${C.borde};font-size:14px;color:${C.tinta};text-align:${cabecera[i]?.der ? 'right' : 'left'};white-space:nowrap;">${v}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export interface MailReporte {
  asunto: string;
  html: string;
  texto: string;
}

export function armarMailReporte({
  cliente,
  datos,
  rep,
  observaciones,
  estudio,
}: {
  cliente: Cliente;
  datos: DatosReporte;
  rep: ConfigReporte;
  observaciones: string;
  estudio: string;
}): MailReporte {
  const { calc, noMono, debeRecategorizar, historial, alertas, pendientes, acciones } = datos;
  const hoy = formatDate(new Date().toISOString(), 'long');
  const titulo = `Reporte de situación ${noMono ? 'fiscal' : 'de monotributo'}`;
  const partes: string[] = [];
  const texto: string[] = [`${titulo} — ${cliente.nombre} (CUIT ${formatCuit(cliente.cuit)})`, `Generado el ${hoy}`, ''];

  // Cabecera
  partes.push(`
<div style="background:#ffffff;border:1px solid ${C.borde};border-radius:12px;padding:28px 24px;">
  <div style="font-size:13px;color:${C.suave};">${esc(estudio)} · ${esc(hoy)}</div>
  <h1 style="margin:6px 0 4px;font-size:21px;color:${C.tinta};">${esc(titulo)}</h1>
  <div style="font-size:15px;color:${C.tinta};"><strong>${esc(cliente.nombre)}</strong> · CUIT ${esc(formatCuit(cliente.cuit))}</div>
  <div style="font-size:13px;color:${C.suave};margin-top:2px;">${esc(etiquetaRegimen(cliente.regimen))}${
    !noMono && cliente.categoria ? ` · Categoría ${esc(cliente.categoria)}` : ''
  }</div>`);

  // Observaciones del contador: primero, es lo que más importa a quien lo recibe.
  const obs = observaciones.trim();
  if (obs) {
    partes.push(
      `<div style="margin-top:20px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;padding:14px 16px;">
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${C.primario};font-weight:bold;margin-bottom:4px;">Mensaje de tu contador</div>
        <div style="font-size:14px;line-height:1.55;color:${C.tinta};white-space:pre-wrap;">${esc(obs)}</div>
      </div>`,
    );
    texto.push('Mensaje de tu contador:', obs, '');
  }

  // Situación
  if (rep.secciones.situacion) {
    if (noMono) {
      partes.push(h2('Situación fiscal'));
      partes.push(
        p(
          `${esc(etiquetaRegimen(cliente.regimen))}. Facturación de los últimos 12 meses: <strong style="color:${C.tinta};">${esc(formatCurrency(calc.facturacionUltimos12))}</strong>.`,
        ),
      );
      texto.push(`Facturación últimos 12 meses: ${formatCurrency(calc.facturacionUltimos12)}`, '');
    } else {
      const visibles = datos.metricasDisponibles.filter(m => rep.metricas[m.key]);
      if (visibles.length) {
        partes.push(h2('Situación de monotributo'));
        // Grilla de 2 columnas con tablas (los mails no respetan grid/flex).
        const celdas = visibles.map(
          m =>
            `<td width="50%" style="padding:6px;vertical-align:top;"><div style="border:1px solid ${C.borde};border-radius:8px;padding:12px 14px;">
              <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:${C.suave};">${esc(m.label)}</div>
              <div style="font-size:18px;font-weight:bold;color:${C.tinta};margin-top:3px;">${esc(m.valor)}</div>
            </div></td>`,
        );
        let filas = '';
        for (let i = 0; i < celdas.length; i += 2) {
          filas += `<tr>${celdas[i]}${celdas[i + 1] ?? '<td width="50%"></td>'}</tr>`;
        }
        partes.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;">${filas}</table>`);
        texto.push('Situación de monotributo:', ...visibles.map(m => `- ${m.label}: ${m.valor}`), '');
      }
      if (debeRecategorizar) {
        const msg = `Con la facturación actual, debería recategorizarse a Cat. ${calc.categoriaCorresponde.codigo} (tope ${formatCurrency(calc.categoriaCorresponde.topeAnual)}).`;
        partes.push(
          `<div style="margin-top:12px;background:${C.aviso};border:1px solid ${C.avisoBorde};border-radius:8px;padding:12px 14px;font-size:14px;color:${C.tinta};">${esc(msg)}</div>`,
        );
        texto.push(msg);
      }
      if (calc.proximaVentana) {
        const msg = `Próxima ventana de recategorización: ${formatDate(calc.proximaVentana.fechaLimite, 'long')} (semestre ${calc.proximaVentana.semestre}).`;
        partes.push(p(esc(msg)));
        texto.push(msg, '');
      }
    }
  }

  // Historial
  if (rep.secciones.historial && historial.length > 0) {
    partes.push(h2(`Historial de los últimos ${historial.length === 1 ? 'mes' : `${historial.length} meses`}`));
    partes.push(
      tabla(
        [{ t: 'Mes' }, { t: 'Ventas netas', der: true }, { t: 'Compras', der: true }],
        historial.map(m => [esc(mesLegible(m.mes)), esc(formatCurrency(m.emitidasNetas)), esc(formatCurrency(m.recibidas))]),
      ),
    );
    texto.push('Historial:', ...historial.map(m => `- ${mesLegible(m.mes)}: ventas ${formatCurrency(m.emitidasNetas)} · compras ${formatCurrency(m.recibidas)}`), '');
  }

  // Alertas
  if (rep.secciones.alertas) {
    partes.push(h2('Alertas'));
    if (alertas.length === 0) {
      partes.push(p('Sin alertas activas.'));
      texto.push('Alertas: sin alertas activas.', '');
    } else {
      partes.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${alertas
          .map(
            a => `<tr><td width="16" style="vertical-align:top;padding:9px 0 0;"><div style="width:8px;height:8px;border-radius:4px;background:${SEV[a.severidad] ?? SEV.datos};"></div></td>
            <td style="padding:4px 0;font-size:14px;line-height:1.5;color:${C.tinta};"><strong>${esc(a.titulo)}.</strong> <span style="color:${C.suave};">${esc(a.detalle)}</span></td></tr>`,
          )
          .join('')}</table>`,
      );
      texto.push('Alertas:', ...alertas.map(a => `- ${a.titulo}. ${a.detalle}`), '');
    }
  }

  // Movimientos pendientes de respaldo
  if (rep.secciones.movimientos) {
    partes.push(h2('Movimientos pendientes de respaldo fiscal'));
    if (pendientes.length === 0) {
      partes.push(p('No hay movimientos pendientes de respaldo.'));
    } else {
      partes.push(
        tabla(
          [{ t: 'Fecha' }, { t: 'Originante' }, { t: 'Monto', der: true }],
          pendientes.map(m => [
            esc(formatDate(m.fecha)),
            `${esc(m.nombreOriginante || m.descripcion || '—')}${m.cuitOriginante ? ` <span style="color:${C.suave};">· ${esc(formatCuit(m.cuitOriginante))}</span>` : ''}`,
            esc(formatCurrency(m.monto)),
          ]),
        ),
      );
      texto.push('Movimientos pendientes de respaldo:', ...pendientes.map(m => `- ${formatDate(m.fecha)} ${m.nombreOriginante || m.descripcion || ''}: ${formatCurrency(m.monto)}`), '');
    }
  }

  // Acciones sugeridas
  if (rep.secciones.acciones && acciones.length > 0) {
    partes.push(h2('Acciones sugeridas'));
    partes.push(
      `<ul style="margin:0;padding-left:20px;">${acciones
        .map(a => `<li style="font-size:14px;line-height:1.55;color:${C.tinta};margin:3px 0;">${esc(a)}</li>`)
        .join('')}</ul>`,
    );
    texto.push('Acciones sugeridas:', ...acciones.map(a => `- ${a}`), '');
  }

  partes.push('</div>');

  const mesAnio = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return {
    asunto: `Reporte de ${noMono ? 'situación fiscal' : 'monotributo'} — ${cliente.nombre} — ${mesAnio}`,
    html: partes.join('\n'),
    texto: texto.join('\n'),
  };
}
