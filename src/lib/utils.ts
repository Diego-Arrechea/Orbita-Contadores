import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, options?: { compact?: boolean }) {
  if (options?.compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }
  if (options?.compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, decimals = 0) {
  return `${(value * 100).toFixed(decimals).replace('.', ',')}%`;
}

export function formatCuit(cuit: string) {
  const clean = cuit.replace(/\D/g, '');
  if (clean.length !== 11) return cuit;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

export function formatDate(date: Date | string, format: 'short' | 'long' | 'mes' = 'short') {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (format === 'long') {
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  if (format === 'mes') {
    return d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
