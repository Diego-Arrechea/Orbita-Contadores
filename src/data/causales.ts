import type { Causal } from '@/types';

export const CAUSALES_EXCLUSION: Causal[] = [
  {
    codigo: 'c1',
    descripcion: 'Superar el tope de ingresos de la categoría K',
    modo: 'auto',
  },
  {
    codigo: 'c2',
    descripcion: 'Superar el ratio de compras/gastos respecto al tope de Cat K',
    modo: 'auto',
  },
  {
    codigo: 'c3',
    descripcion: 'Depósitos bancarios incompatibles con los ingresos declarados',
    modo: 'auto',
  },
  {
    codigo: 'c4',
    descripcion: 'Superar el precio máximo unitario de venta de cosas muebles',
    modo: 'parcial',
  },
  {
    codigo: 'c5',
    descripcion: 'Superar parámetros físicos (superficie, energía, alquiler) de Cat K',
    modo: 'manual',
  },
  {
    codigo: 'c6',
    descripcion: 'Gastos personales incompatibles con los ingresos declarados',
    modo: 'manual',
  },
  {
    codigo: 'c7',
    descripcion: 'Importaciones de mercadería o servicios para comercialización',
    modo: 'manual',
  },
  {
    codigo: 'c8',
    descripcion: 'Más de 3 actividades simultáneas o más de 3 unidades de explotación',
    modo: 'manual',
  },
  {
    codigo: 'c9',
    descripcion: 'Categorizado como comercio realizando servicios (o viceversa)',
    modo: 'manual',
  },
  {
    codigo: 'c10',
    descripcion: 'Operaciones sin respaldo de facturas o documentos equivalentes',
    modo: 'manual',
  },
  {
    codigo: 'c11',
    descripcion: 'Incluido en el REPSAL como reincidente',
    modo: 'manual',
  },
  {
    codigo: 'c12',
    descripcion: 'Compra de bienes patrimoniales incompatibles con los ingresos',
    modo: 'auto',
  },
];
