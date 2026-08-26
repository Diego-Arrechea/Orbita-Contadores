"""Escala oficial de Monotributo (ARCA), ESPEJO de `src/data/categorias.ts`.

Esta tabla la usa el motor de alertas del backend (services/monotributo.py) para evaluar % del tope,
categoría que corresponde y ratio de gastos sin depender del front.

Los valores de acá son el FALLBACK. La escala se reajusta cada semestre, así que igual que en el
front la tabla se pisa en memoria con la vigente (`aplicar_montos_oficiales`, alimentada por
services/categorias_afip). Que las dos puntas se actualicen solas importa: el front muestra el tope
en pantalla y el backend decide qué alerta se ENVÍA — si una escala se atrasa respecto de la otra,
el contador ve "todo bien" y le llega un aviso de recategorización (o al revés).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Categoria:
    codigo: str
    tope_anual: float
    cuota_servicios: float
    cuota_comercio: float


# Escala de referencia (última verificada: 2026-08). Sólo replicamos los campos que el motor de
# alertas necesita (código + tope + cuotas); superficie/energía/alquiler/precio unitario no entran en
# ninguna alerta. La lista se muta IN-PLACE al aplicar los montos oficiales: quien la importó
# conserva la misma referencia y ve los valores nuevos.
CATEGORIAS: list[Categoria] = [
    Categoria("A", 12_009_410.45, 49_527.18, 49_527.18),
    Categoria("B", 17_595_182.74, 56_379.08, 56_379.08),
    Categoria("C", 24_670_494.31, 66_020.12, 64_530.58),
    Categoria("D", 30_628_651.43, 84_612.93, 82_564.81),
    Categoria("E", 36_028_231.33, 119_811.45, 108_267.51),
    Categoria("F", 45_151_659.41, 150_784.21, 129_930.65),
    Categoria("G", 53_995_798.87, 230_312.94, 158_815.05),
    Categoria("H", 81_924_660.37, 522_706.68, 317_895.01),
    Categoria("I", 91_699_761.90, 963_747.86, 474_992.78),
    Categoria("J", 105_012_519.20, 1_167_299.76, 580_793.69),
    Categoria("K", 126_610_838.75, 1_614_446.04, 702_103.24),
]

# Umbrales legales del ratio gastos / tope Cat K (art. 20, inc. j).
RATIO_GASTOS_COMERCIO = 0.80
RATIO_GASTOS_SERVICIOS = 0.40


def tope_categoria_k() -> float:
    """Tope de la categoría más alta, que es contra el que se mide el ratio de gastos. Es una
    FUNCIÓN y no una constante a propósito: un `from ... import TOPE_CATEGORIA_K` congela el número
    del import y se perdería la actualización de la escala."""
    return CATEGORIAS[-1].tope_anual


def aplicar_montos_oficiales(oficiales) -> bool:
    """Pisa la escala local con la vigente que publica el organismo. Muta CATEGORIAS in-place (misma
    referencia de lista para todos los que la importaron). `oficiales` son CategoriaOficial de
    services/categorias_afip. Devuelve si aplicó algo."""
    if not oficiales:
        return False
    por_codigo = {c.codigo: c for c in oficiales}
    aplicados = 0
    for i, local in enumerate(CATEGORIAS):
        o = por_codigo.get(local.codigo)
        if o is None:
            continue
        CATEGORIAS[i] = Categoria(
            local.codigo, float(o.topeAnual), float(o.cuotaServicios), float(o.cuotaComercio)
        )
        aplicados += 1
    return aplicados > 0


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
