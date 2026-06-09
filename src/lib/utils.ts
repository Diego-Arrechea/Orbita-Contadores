import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, options?: { compact?: boolean; moneda?: string }) {
  const moneda = options?.moneda ?? 'ARS';
  if (options?.compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }
  if (options?.compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: moneda,
      // ARS sin decimales (como siempre); moneda extranjera con 2 (un total de US$ 81,31 los necesita).
      maximumFractionDigits: moneda === 'ARS' ? 0 : 2,
    }).format(value);
  } catch {
    // Código de moneda no reconocido por Intl: fallback a "<código> <número>".
    return `${moneda} ${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
  }
}

export function formatPercent(value: number, decimals = 0) {
  return `${(value * 100).toFixed(decimals).replace('.', ',')}%`;
}

export function formatCuit(cuit: string) {
  const clean = cuit.replace(/\D/g, '');
  if (clean.length !== 11) return cuit;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

/**
 * ¿El CUIT es de una persona jurídica (sociedad: S.R.L., S.A., etc.)? Se deduce del prefijo:
 * 30/33/34 = persona jurídica; 20/23/24/27 = persona física. Las sociedades no son monotributistas
 * ni autónomos, así que no tienen cuenta corriente de Monotributo/Autónomos (CCMA).
 */
export function esPersonaJuridica(cuit: string): boolean {
  const p = cuit.replace(/\D/g, '').slice(0, 2);
  return p === '30' || p === '33' || p === '34';
}

/**
 * Convierte a Date respetando el día. Una fecha "solo-fecha" (yyyy-mm-dd) se interpreta en horario
 * LOCAL: `new Date('2026-06-01')` la tomaría como medianoche UTC y, en Argentina (UTC-3), la
 * mostraría un día antes (31/05). Los strings con hora (ISO completo) van por `new Date` normal.
 */
function aDate(date: Date | string): Date {
  if (typeof date !== 'string') return date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(date);
}

export function formatDate(date: Date | string, format: 'short' | 'long' | 'mes' = 'short') {
  const d = aDate(date);
  if (format === 'long') {
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  if (format === 'mes') {
    return d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
