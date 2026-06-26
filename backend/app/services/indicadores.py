"""Indicadores macro de fuentes oficiales para alimentar las proyecciones del panel.

Hoy: inflación ESPERADA del REM (Relevamiento de Expectativas de Mercado) que publica el BCRA. El
REM da la mediana de la inflación INTERANUAL esperada para los próximos 12 meses (idVariable 29 de
la API de Principales Variables). La proyección de monotributo trabaja con una tasa MENSUAL, así que
convertimos esa interanual a su equivalente mensual compuesta: (1 + ia) ** (1/12) - 1.

Cacheamos en memoria (el dato del REM se actualiza ~1 vez al mes, no hace falta pegarle seguido).
Ante una falla transitoria de la fuente devolvemos el último valor conocido; si nunca se pudo traer,
None (y el front cae a su default). Es de sólo lectura y sin secretos, así que no toca la DB.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import requests

# idVariable 29 = "Mediana de la variación interanual próximos 12 meses del IPC del REM".
_BCRA_URL = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/29?limit=1"
_TTL_SEGUNDOS = 6 * 60 * 60  # 6 h: el REM es mensual, alcanza con refrescar un par de veces por día.
_TIMEOUT = 12


@dataclass
class InflacionEsperada:
    mensual: float        # tasa mensual equivalente (ej 0.0176 = 1,76%)
    interanual: float     # variación i.a. esperada (ej 0.233 = 23,3%)
    fecha: str            # fecha del dato (ISO, ej "2026-05-31")
    fuente: str = "REM"   # Relevamiento de Expectativas de Mercado (BCRA)


_cache: Optional[InflacionEsperada] = None
_cache_ts: float = 0.0


def _traer_bcra() -> InflacionEsperada:
    r = requests.get(_BCRA_URL, timeout=_TIMEOUT)
    r.raise_for_status()
    detalle = r.json()["results"][0]["detalle"][0]
    ia = float(detalle["valor"]) / 100.0            # viene en %, ej 23.3 -> 0.233
    mensual = (1.0 + ia) ** (1.0 / 12.0) - 1.0      # interanual -> mensual compuesta
    return InflacionEsperada(mensual=mensual, interanual=ia, fecha=str(detalle["fecha"]))


def inflacion_esperada() -> Optional[InflacionEsperada]:
    """Inflación mensual esperada (mediana del REM). Cacheada; ante falla devuelve el último valor o None."""
    global _cache, _cache_ts
    ahora = time.monotonic()
    if _cache is not None and (ahora - _cache_ts) < _TTL_SEGUNDOS:
        return _cache
    try:
        _cache = _traer_bcra()
        _cache_ts = ahora
    except Exception:
        # Falla transitoria de la fuente: conservamos el último valor conocido (si lo hay).
        pass
    return _cache
