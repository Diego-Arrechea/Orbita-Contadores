import { apiDelete, apiGet, apiPost, apiPut } from './apiClient';

export type FrecuenciaEnvio = 'unica' | 'mensual' | 'semanal';

export interface ProgramacionPayload {
  frecuencia: FrecuenciaEnvio;
  hora: string; // HH:MM, hora de Argentina
  fecha?: string | null; // aaaa-mm-dd (unica)
  dia_mes?: number | null; // 1..31 (31 = último día del mes)
  dia_semana?: number | null; // 0 lunes … 6 domingo
  destinos: { cuit: string; destino: string }[];
  mensaje: string;
  copia_a_mi: boolean;
}

export interface ResultadoEnvio {
  cuit: string;
  nombre: string;
  destino: string;
  ok: boolean;
  error: string | null;
}

export interface ReporteProgramado extends Omit<ProgramacionPayload, 'destinos'> {
  id: number;
  destinos: { cuit: string; destino: string; nombre: string }[];
  activo: boolean;
  proximo_envio: string | null;
  ultimo_envio_en: string | null;
  ultimo_resultado: ResultadoEnvio[] | null;
  creado_en: string | null;
}

export const getReportesProgramados = () => apiGet<ReporteProgramado[]>('/reportes-programados');
export const crearReporteProgramado = (p: ProgramacionPayload) =>
  apiPost<ReporteProgramado>('/reportes-programados', p);
export const editarReporteProgramado = (id: number, p: ProgramacionPayload) =>
  apiPut<ReporteProgramado>(`/reportes-programados/${id}`, p);
export const cambiarEstadoReporteProgramado = (id: number, activo: boolean) =>
  apiPut<ReporteProgramado>(`/reportes-programados/${id}/estado`, { activo });
export const borrarReporteProgramado = (id: number) => apiDelete<{ ok: boolean }>(`/reportes-programados/${id}`);

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** "Una vez, el 15/10/2026 a las 09:00" · "Todos los meses, el día 5 a las 09:00" · … */
export function describirProgramacion(p: Pick<ProgramacionPayload, 'frecuencia' | 'hora' | 'fecha' | 'dia_mes' | 'dia_semana'>): string {
  if (p.frecuencia === 'unica' && p.fecha) {
    const [y, m, d] = p.fecha.split('-');
    return `Una vez, el ${d}/${m}/${y} a las ${p.hora}`;
  }
  if (p.frecuencia === 'mensual') {
    return p.dia_mes === 31
      ? `Todos los meses, el último día a las ${p.hora}`
      : `Todos los meses, el día ${p.dia_mes} a las ${p.hora}`;
  }
  return `Todos los ${DIAS_SEMANA[p.dia_semana ?? 0]} a las ${p.hora}`;
}

/** Fecha y hora de Argentina, legible: "jue 15/10/2026 09:00". */
export function fechaHoraAR(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
