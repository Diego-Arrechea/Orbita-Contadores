import type { Categoria } from '@/types';

// Escala oficial de Monotributo vigente (ARCA). Verificado 2026-06 contra la tabla de categorías de
// ARCA (arca.gob.ar/monotributo/categorias.asp) y el facturómetro del propio contribuyente.
//   topeAnual               = "Ingresos brutos" (límite anual de la categoría).
//   cuotaServicios/Comercio = "Total" de cada actividad (impuesto integrado + aportes SIPA + obra
//                             social); es el FALLBACK de la cuota mensual cuando no tenemos el
//                             importe real del cliente (cliente.proxVencImporte lo pisa).
//   alquilerMaxAnual        = "Alquileres devengados anualmente".
//   topePrecioUnitario      = "Precio unitario máximo para venta de cosas muebles".
// OJO: ARCA reajusta esta escala cada semestre. Estos valores son el FALLBACK: al iniciar, el front
// pide la escala vigente al backend (GET /indicadores/categorias, tabla pública de ARCA) y la pisa
// con `aplicarMontosOficiales`. Si esa fuente falla, quedan estos valores. Mantener actualizados igual.
export const CATEGORIAS: Categoria[] = [
  { codigo: 'A', topeAnual: 10_277_988,  cuotaServicios: 42_387,    cuotaComercio: 42_387,   superficieMax: 30,  energiaMaxKwh: 3_330,   alquilerMaxAnual: 2_390_230 },
  { codigo: 'B', topeAnual: 15_058_448,  cuotaServicios: 48_251,    cuotaComercio: 48_251,   superficieMax: 45,  energiaMaxKwh: 5_000,   alquilerMaxAnual: 2_390_230 },
  { codigo: 'C', topeAnual: 21_113_697,  cuotaServicios: 56_502,    cuotaComercio: 55_227,   superficieMax: 60,  energiaMaxKwh: 6_700,   alquilerMaxAnual: 3_266_647 },
  { codigo: 'D', topeAnual: 26_212_853,  cuotaServicios: 72_414,    cuotaComercio: 70_661,   superficieMax: 85,  energiaMaxKwh: 10_000,  alquilerMaxAnual: 3_266_647 },
  { codigo: 'E', topeAnual: 30_833_964,  cuotaServicios: 102_538,   cuotaComercio: 92_658,   superficieMax: 110, energiaMaxKwh: 13_000,  alquilerMaxAnual: 4_143_065 },
  { codigo: 'F', topeAnual: 38_642_048,  cuotaServicios: 129_045,   cuotaComercio: 111_198,  superficieMax: 150, energiaMaxKwh: 16_500,  alquilerMaxAnual: 4_143_065 },
  { codigo: 'G', topeAnual: 46_211_109,  cuotaServicios: 197_108,   cuotaComercio: 135_918,  superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 4_939_808 },
  { codigo: 'H', topeAnual: 70_113_407,  cuotaServicios: 447_347,   cuotaComercio: 272_063,  superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 7_170_689 },
  { codigo: 'I', topeAnual: 78_479_212,  cuotaServicios: 824_802,   cuotaComercio: 406_512,  superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 7_170_689, topePrecioUnitario: 613_492 },
  { codigo: 'J', topeAnual: 89_872_640,  cuotaServicios: 999_008,   cuotaComercio: 497_059,  superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 7_170_689, topePrecioUnitario: 613_492 },
  { codigo: 'K', topeAnual: 108_357_084, cuotaServicios: 1_381_688, cuotaComercio: 600_880,  superficieMax: 200, energiaMaxKwh: 20_000,  alquilerMaxAnual: 7_170_689, topePrecioUnitario: 613_492 },
];

// `let` (no const) a propósito: `aplicarMontosOficiales` lo repisa con el valor vigente de ARCA. Los
// imports son bindings VIVOS (ESM), así que los consumidores ven el valor actualizado.
export let TOPE_CATEGORIA_K = 108_357_084;

// Precio unitario máximo para la venta de cosas muebles (productos). A diferencia de los topes de
// ingresos, este límite es ÚNICO y aplica a TODAS las categorías (A→K), no sólo a las altas: un
// monotributista no puede vender un producto a un precio unitario mayor a este valor. No alcanza a
// servicios. ARCA no rechaza el comprobante que lo supera, pero queda registrado → lo avisamos al
// emitir. (El campo `topePrecioUnitario` por categoría queda como referencia del dato oficial.)
export let TOPE_PRECIO_UNITARIO = 613_492;

// Pisa la escala local con los montos OFICIALES vigentes (tabla pública de ARCA, vía el backend).
// Muta CATEGORIAS in-place (los imports guardan la MISMA referencia de array, así que ven los nuevos
// valores) y reasigna los topes derivados. Si nunca se llama (backend caído), quedan los valores
// hardcodeados como fallback. Se llama una vez al iniciar (ConfigContext).
export function aplicarMontosOficiales(oficiales: readonly Categoria[]): void {
  for (const o of oficiales) {
    const local = CATEGORIAS.find(c => c.codigo === o.codigo);
    if (!local) continue;
    local.topeAnual = o.topeAnual;
    local.cuotaServicios = o.cuotaServicios;
    local.cuotaComercio = o.cuotaComercio;
    local.superficieMax = o.superficieMax;
    local.energiaMaxKwh = o.energiaMaxKwh;
    local.alquilerMaxAnual = o.alquilerMaxAnual;
    if (local.topePrecioUnitario !== undefined && o.topePrecioUnitario) {
      local.topePrecioUnitario = o.topePrecioUnitario;
    }
  }
  const k = CATEGORIAS.find(c => c.codigo === 'K');
  if (k) TOPE_CATEGORIA_K = k.topeAnual;
  const pu = oficiales.find(o => o.topePrecioUnitario)?.topePrecioUnitario;
  if (pu) TOPE_PRECIO_UNITARIO = pu;
}

export function getCategoria(codigo: string | null | undefined): Categoria {
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
