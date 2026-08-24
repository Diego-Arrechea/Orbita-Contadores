/**
 * Apartado de Contabilidad (plan de cuentas + libro diario). Sólo HTTP contra el backend, que
 * además valida el gate (allowlist CONTABILIDAD_EMAILS + admins) en cada endpoint: el front sólo
 * esconde el menú con puedeVerContabilidad().
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient';

/** De qué lado suma la cuenta en los informes. */
export type TipoCuenta =
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'resultado_positivo'
  | 'resultado_negativo';

export const TIPOS_CUENTA: { valor: TipoCuenta; label: string }[] = [
  { valor: 'activo', label: 'Activo' },
  { valor: 'pasivo', label: 'Pasivo' },
  { valor: 'patrimonio', label: 'Patrimonio neto' },
  { valor: 'resultado_positivo', label: 'Ingresos' },
  { valor: 'resultado_negativo', label: 'Egresos' },
];

export interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  /** false = es un título que ordena el plan (no recibe asientos). */
  imputable: boolean;
}

/** Alta/edición de una cuenta; también es la fila del import de Excel. */
export interface CuentaNueva {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  imputable: boolean;
}

export interface AsientoLinea {
  codigo: string;
  cuenta: string;
  debe: number;
  haber: number;
  /** true = la cuenta la eligió Órbita por defecto; conviene revisarla. */
  porDefecto: boolean;
}

export interface Asiento {
  id: string;
  fecha: string; // ISO aaaa-mm-dd
  lado: 'ventas' | 'compras';
  comprobante: string;
  contraparte: string;
  detalle: string;
  lineas: AsientoLinea[];
  total: number;
  revisar: boolean;
}

export interface DiarioTotales {
  asientos: number;
  debe: number;
  haber: number;
  revisar: number;
}

export interface Diario {
  cuit: string;
  periodo: string;
  asientos: Asiento[];
  totales: DiarioTotales;
  /** true = el cliente todavía no tiene plan de cuentas (hay que armarlo antes del diario). */
  sinPlan: boolean;
}

export interface PeriodoContable {
  periodo: string; // aaaa-mm
  label: string; // 'Julio 2026'
  ventas: number;
  compras: number;
}

/** Meses con comprobantes del cliente (más reciente primero), para el selector. */
export function getPeriodosContables(cuit: string): Promise<PeriodoContable[]> {
  return apiGet<PeriodoContable[]>(`/contabilidad/clientes/${cuit}/periodos`);
}

/** Plan de cuentas del cliente (vacío si todavía no lo armó). */
export function getPlanCuentas(cuit: string): Promise<Cuenta[]> {
  return apiGet<Cuenta[]>(`/contabilidad/clientes/${cuit}/plan`);
}

/** Crea el plan de cuentas sugerido. Idempotente: sólo agrega lo que falta. */
export function sembrarPlanCuentas(cuit: string): Promise<{ creadas: number }> {
  return apiPost<{ creadas: number }>(`/contabilidad/clientes/${cuit}/plan/sembrar`);
}

export interface ImportPlanResumen {
  creadas: number;
  actualizadas: number;
  /** Cuentas que Órbita agregó porque los asientos automáticos las necesitan. */
  sistema: number;
}

/** Importa el plan que el estudio ya usa (upsert por código; no borra nada). */
export function importarPlanCuentas(
  cuit: string,
  cuentas: CuentaNueva[]
): Promise<ImportPlanResumen> {
  return apiPost<ImportPlanResumen>(`/contabilidad/clientes/${cuit}/plan/importar`, { cuentas });
}

export function crearCuenta(cuit: string, cuenta: CuentaNueva): Promise<Cuenta> {
  return apiPost<Cuenta>(`/contabilidad/clientes/${cuit}/plan`, cuenta);
}

export function editarCuenta(cuit: string, id: number, cuenta: CuentaNueva): Promise<Cuenta> {
  return apiPatch<Cuenta>(`/contabilidad/clientes/${cuit}/plan/${id}`, cuenta);
}

export function borrarCuenta(cuit: string, id: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/contabilidad/clientes/${cuit}/plan/${id}`);
}

/** Libro diario del período: un asiento por comprobante. */
export function getDiario(cuit: string, periodo: string): Promise<Diario> {
  return apiGet<Diario>(
    `/contabilidad/clientes/${cuit}/diario?periodo=${encodeURIComponent(periodo)}`
  );
}
