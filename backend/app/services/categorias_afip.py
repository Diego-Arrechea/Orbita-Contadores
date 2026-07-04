"""Escala oficial de Monotributo (categorías + montos) desde la tabla PÚBLICA de ARCA, para que el
front no dependa de valores hardcodeados que ARCA reajusta cada semestre.

Fuente: https://www.arca.gob.ar/monotributo/categorias.asp — una sola tabla con, por categoría A→K:
ingresos brutos (tope), superficie, energía, alquiler, precio unitario, impuesto integrado, aportes
SIPA, aportes obra social y el TOTAL (= la cuota mensual), separando Locaciones de Servicios vs Venta
de Cosas Muebles. Sin login. Cacheado en memoria (cambia ~1 vez por semestre).

Validamos la tabla antes de servirla (11 categorías A→K, topes crecientes, cuotas > 0); si algo no
cierra o la fuente falla, devolvemos el último valor bueno o None → el front cae a su tabla local.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Optional

import lxml.html
import requests

_URL = "https://www.arca.gob.ar/monotributo/categorias.asp"
_TTL_SEGUNDOS = 24 * 60 * 60  # la escala cambia por semestre; con refrescar 1 vez al día sobra.
_TIMEOUT = 15
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")
_CODIGOS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]


@dataclass
class CategoriaOficial:
    codigo: str
    topeAnual: float
    cuotaServicios: float
    cuotaComercio: float
    superficieMax: int
    energiaMaxKwh: int
    alquilerMaxAnual: float
    topePrecioUnitario: float


_cache: Optional[list[CategoriaOficial]] = None
_cache_ts: float = 0.0


def _monto(s: str) -> float:
    """'$10.277.988,13' -> 10277988.13 (formato AR: punto de miles, coma decimal)."""
    s = re.sub(r"[^\d,.-]", "", s or "").replace(".", "").replace(",", ".")
    return float(s) if s not in ("", "-", ".") else 0.0


def _entero(s: str) -> int:
    """'Hasta 30 m2' / 'Hasta 3330 Kw' -> 30 / 3330 (primer número)."""
    m = re.search(r"\d[\d.]*", s or "")
    return int(m.group(0).replace(".", "")) if m else 0


def _parsear(html: str) -> list[CategoriaOficial]:
    doc = lxml.html.fromstring(html)
    filas = doc.xpath("//table//tr")
    out: list[CategoriaOficial] = []
    for tr in filas:
        # El código de categoría suele venir en un <th scope="row">; el resto en <td>.
        cel = [re.sub(r"\s+", " ", (c.text_content() or "").strip()) for c in tr.xpath("./td | ./th")]
        cel = [c for c in cel if c != ""]
        if len(cel) < 12 or cel[0] not in _CODIGOS:
            continue
        # [cat, ingresos, sup, energía, alquiler, precioUnit, integ_serv, integ_vta, sipa, obraSoc,
        #  total_serv, total_vta]. La cuota mensual = TOTAL (últimas dos columnas).
        out.append(CategoriaOficial(
            codigo=cel[0],
            topeAnual=_monto(cel[1]),
            superficieMax=_entero(cel[2]),
            energiaMaxKwh=_entero(cel[3]),
            alquilerMaxAnual=_monto(cel[4]),
            topePrecioUnitario=_monto(cel[5]),
            cuotaServicios=_monto(cel[10]),
            cuotaComercio=_monto(cel[11]),
        ))
    return out


def _valida(cats: list[CategoriaOficial]) -> bool:
    """Sanity-check antes de servir: A→K completas, topes crecientes y cuotas positivas. Si no cierra,
    NO servimos (mejor que el front use su tabla local a mostrar montos rotos a toda la cartera)."""
    if [c.codigo for c in cats] != _CODIGOS:
        return False
    topes = [c.topeAnual for c in cats]
    if topes != sorted(topes) or topes[0] <= 0:
        return False
    return all(c.cuotaServicios > 0 and c.cuotaComercio > 0 for c in cats)


def montos_categorias() -> Optional[list[CategoriaOficial]]:
    """Escala oficial vigente (A→K) de la tabla pública de ARCA. Cacheada; ante falla o tabla inválida
    devuelve el último valor bueno conocido (o None → el front usa su tabla local)."""
    global _cache, _cache_ts
    ahora = time.monotonic()
    if _cache is not None and (ahora - _cache_ts) < _TTL_SEGUNDOS:
        return _cache
    try:
        r = requests.get(_URL, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
        r.raise_for_status()
        cats = _parsear(r.text)
        if _valida(cats):
            _cache = cats
            _cache_ts = ahora
    except Exception:  # noqa: BLE001 — fuente caída / HTML cambiado: conservamos el último bueno
        pass
    return _cache
