import type { Categoria } from '@/types';

// Valores vigentes desde febrero/mayo 2026 (Monotributo)
// Fuente: indicadores.ar/monotributo (datos públicos ARCA)
export const CATEGORIAS: Categoria[] = [
  { codigo: 'A', topeAnual: 7_813_063,  cuotaServicios: 37_919,  cuotaComercio: 37_919,  superficieMax: 30,  energiaMaxKwh: 3_300,   alquilerMaxAnual: 1_563_000  },
  { codigo: 'B', topeAnual: 11_447_046, cuotaServicios: 42_701,  cuotaComercio: 42_701,  superficieMax: 45,  energiaMaxKwh: 5_000,   alquilerMaxAnual: 1_563_000  },
  { codigo: 'C', topeAnual: 16_050_091, cuotaServicios: 49_185,  cuotaComercio: 48_500,  superficieMax: 60,  energiaMaxKwh: 6_700,   alquilerMaxAnual: 3_128_000  },
  { codigo: 'D', topeAnual: 19_926_340, cuotaServicios: 58_463,  cuotaComercio: 57_400,  superficieMax: 85,  energiaMaxKwh: 10_000,  alquilerMaxAnual: 3_128_000  },
  { codigo: 'E', topeAnual: 23_439_944, cuotaServicios: 85_133,  cuotaComercio: 75_000,  superficieMax: 110, energiaMaxKwh: 13_000,  alquilerMaxAnual: 3_906_000  },
  { codigo: 'F', topeAnual: 29_374_695, cuotaServicios: 103_308, cuotaComercio: 90_000,  superficieMax: 150, energiaMaxKwh: 16_500,  alquilerMaxAnual: 3_906_000  },
  { codigo: 'G', topeAnual: 35_128_502, cuotaServicios: 130_361, cuotaComercio: 110_000, superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 4_687_000  },
  { codigo: 'H', topeAnual: 52_649_764, cuotaServicios: 216_247, cuotaComercio: 180_000, superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 5_469_000  },
  { codigo: 'I', topeAnual: 58_565_148, cuotaServicios: 294_340, cuotaComercio: 250_000, superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 5_469_000, topePrecioUnitario: 466_361 },
  { codigo: 'J', topeAnual: 67_520_420, cuotaServicios: 340_472, cuotaComercio: 300_000, superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 5_469_000, topePrecioUnitario: 466_361 },
  { codigo: 'K', topeAnual: 75_046_018, cuotaServicios: 383_608, cuotaComercio: 380_000, superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 7_170_689, topePrecioUnitario: 466_361 },
];

export const TOPE_CATEGORIA_K = 75_046_018;

export function getCategoria(codigo: string): Categoria {
  return CATEGORIAS.find(c => c.codigo === codigo) || CATEGORIAS[0];
}

export function siguienteCategoria(codigo: string): Categoria | null {
  const idx = CATEGORIAS.findIndex(c => c.codigo === codigo);
  if (idx === -1 || idx === CATEGORIAS.length - 1) return null;
  return CATEGORIAS[idx + 1];
}

// Umbrales legales del ratio gastos / tope Cat K (art. 20, inc. j)
export const RATIO_GASTOS_COMERCIO = 0.80;
export const RATIO_GASTOS_SERVICIOS = 0.40;
