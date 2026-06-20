"""Escala oficial de Monotributo (ARCA), ESPEJO de `src/data/categorias.ts`.

Esta tabla la usa el motor de alertas del backend (services/monotributo.py) para evaluar % del tope,
categoría que corresponde y ratio de gastos sin depender del front. La fuente de verdad sigue siendo
el `.ts` (lo muestra la UI); si actualizás una, actualizá la otra. ARCA reajusta la escala cada
semestre → mantener en sync con categorias.ts.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Categoria:
    codigo: str
    tope_anual: float
    cuota_servicios: float
    cuota_comercio: float


# Mismos valores que CATEGORIAS en src/data/categorias.ts (verificado 2026-06). Sólo replicamos los
# campos que el motor de alertas necesita (código + tope + cuotas como fallback); superficie/energía/
# alquiler/precio unitario no entran en ninguna alerta, así que no se duplican acá.
CATEGORIAS: list[Categoria] = [
    Categoria("A", 10_277_988, 42_387, 42_387),
    Categoria("B", 15_058_448, 48_251, 48_251),
    Categoria("C", 21_113_697, 56_502, 55_227),
    Categoria("D", 26_212_853, 72_414, 70_661),
    Categoria("E", 30_833_964, 102_538, 92_658),
    Categoria("F", 38_642_048, 129_045, 111_198),
    Categoria("G", 46_211_109, 197_108, 135_918),
    Categoria("H", 70_113_407, 447_347, 272_063),
    Categoria("I", 78_479_212, 824_802, 406_512),
    Categoria("J", 89_872_640, 999_008, 497_059),
    Categoria("K", 108_357_084, 1_381_688, 600_880),
]

TOPE_CATEGORIA_K = 108_357_084.0

# Umbrales legales del ratio gastos / tope Cat K (art. 20, inc. j).
RATIO_GASTOS_COMERCIO = 0.80
RATIO_GASTOS_SERVICIOS = 0.40


def get_categoria(codigo: str | None) -> Categoria:
    """La categoría del código dado; si es desconocido/None, la más baja (A), igual que el front."""
    for c in CATEGORIAS:
        if c.codigo == codigo:
            return c
    return CATEGORIAS[0]


def inferir_categoria(facturacion_12m: float) -> str:
    """Código de la categoría que encuadra esa facturación 12m (la última si la supera toda).
    Espejo de inferirCategoria() en src/services/clientesService.ts."""
    for c in CATEGORIAS:
        if facturacion_12m <= c.tope_anual:
            return c.codigo
    return CATEGORIAS[-1].codigo
