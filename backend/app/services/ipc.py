"""Índice de precios (IPC nacional) para expresar facturación de distintos períodos en pesos de un
mismo mes ("pesos de hoy"). Sumar pesos nominales de años distintos no dice nada con la inflación
argentina: para comparar/acumular hay que deflactar cada período a un mes de referencia.

Fuente: serie de inflación mensual (variación % del IPC) que publica el BCRA en su API pública
(idVariable 27), la misma que ya usamos para la inflación esperada (ver `indicadores.py`). La
componemos en un ÍNDICE acumulado y de ahí sale el coeficiente entre dos meses. Cacheamos en memoria
(la serie agrega un dato por mes) y, ante una falla de la fuente, caemos a una tabla SEMILLA con los
valores históricos ya conocidos, así el cálculo nunca queda sin índice. Sólo lectura, sin secretos.

El resultado es una CIFRA DE REFERENCIA (estimación por IPC nacional), no un dato impositivo: los
controles de tope/recategorización siguen siendo sobre los valores nominales de cada período.
"""
from __future__ import annotations

import datetime as dt
import time
from typing import Optional

import requests

# idVariable 27 = "Inflación mensual (variación en %)" del IPC (INDEC), publicada por el BCRA.
_BCRA_URL = "https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/27"
_TTL_SEGUNDOS = 12 * 60 * 60  # el IPC es mensual; alcanza con refrescar un par de veces por día.
_TIMEOUT = 12

# Fallback: variación mensual del IPC (%) por mes 'aaaa-mm'. Valores oficiales ya publicados; se usan
# si la fuente no responde y, además, como base que el fetch del BCRA extiende/pisa con lo más nuevo.
_SEMILLA: dict[str, float] = {
    "2016-01": 4.1, "2016-02": 2.7, "2016-03": 3.0, "2016-04": 3.4, "2016-05": 4.2, "2016-06": 3.1,
    "2016-07": 2.0, "2016-08": 0.2, "2016-09": 1.1, "2016-10": 2.4, "2016-11": 1.6, "2016-12": 1.2,
    "2017-01": 1.3, "2017-02": 2.5, "2017-03": 2.4, "2017-04": 2.6, "2017-05": 1.3, "2017-06": 1.2,
    "2017-07": 1.7, "2017-08": 1.4, "2017-09": 1.9, "2017-10": 1.5, "2017-11": 1.4, "2017-12": 3.1,
    "2018-01": 1.8, "2018-02": 2.4, "2018-03": 2.3, "2018-04": 2.7, "2018-05": 2.1, "2018-06": 3.7,
    "2018-07": 3.1, "2018-08": 3.9, "2018-09": 6.5, "2018-10": 5.4, "2018-11": 3.2, "2018-12": 2.6,
    "2019-01": 2.9, "2019-02": 3.8, "2019-03": 4.7, "2019-04": 3.4, "2019-05": 3.1, "2019-06": 2.7,
    "2019-07": 2.2, "2019-08": 4.0, "2019-09": 5.9, "2019-10": 3.3, "2019-11": 4.3, "2019-12": 3.7,
    "2020-01": 2.3, "2020-02": 2.0, "2020-03": 3.3, "2020-04": 1.5, "2020-05": 1.5, "2020-06": 2.2,
    "2020-07": 1.9, "2020-08": 2.7, "2020-09": 2.8, "2020-10": 3.8, "2020-11": 3.2, "2020-12": 4.0,
    "2021-01": 4.0, "2021-02": 3.6, "2021-03": 4.8, "2021-04": 4.1, "2021-05": 3.3, "2021-06": 3.2,
    "2021-07": 3.0, "2021-08": 2.5, "2021-09": 3.5, "2021-10": 3.5, "2021-11": 2.5, "2021-12": 3.8,
    "2022-01": 3.9, "2022-02": 4.7, "2022-03": 6.7, "2022-04": 6.0, "2022-05": 5.1, "2022-06": 5.3,
    "2022-07": 7.4, "2022-08": 7.0, "2022-09": 6.2, "2022-10": 6.3, "2022-11": 4.9, "2022-12": 5.1,
    "2023-01": 6.0, "2023-02": 6.6, "2023-03": 7.7, "2023-04": 8.4, "2023-05": 7.8, "2023-06": 6.0,
    "2023-07": 6.3, "2023-08": 12.4, "2023-09": 12.7, "2023-10": 8.3, "2023-11": 12.8, "2023-12": 25.5,
    "2024-01": 20.6, "2024-02": 13.2, "2024-03": 11.0, "2024-04": 8.8, "2024-05": 4.2, "2024-06": 4.6,
    "2024-07": 4.0, "2024-08": 4.2, "2024-09": 3.5, "2024-10": 2.7, "2024-11": 2.4, "2024-12": 2.7,
    "2025-01": 2.2, "2025-02": 2.4, "2025-03": 3.7, "2025-04": 2.8, "2025-05": 1.5, "2025-06": 1.6,
    "2025-07": 1.9, "2025-08": 1.9, "2025-09": 2.1, "2025-10": 2.3, "2025-11": 2.5, "2025-12": 2.8,
    "2026-01": 2.9, "2026-02": 2.9, "2026-03": 3.4, "2026-04": 2.6, "2026-05": 2.1, "2026-06": 1.9,
}

_cache_variaciones: Optional[dict[str, float]] = None
_cache_ts: float = 0.0


def _traer_bcra() -> dict[str, float]:
    """Variación mensual del IPC (%) por mes 'aaaa-mm' desde el BCRA. Cubre 2016 en adelante."""
    r = requests.get(
        _BCRA_URL, params={"desde": "2016-01-01", "hasta": "2100-01-01", "limit": 3000},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    detalle = r.json()["results"][0]["detalle"]
    return {str(d["fecha"])[:7]: float(d["valor"]) for d in detalle}


def _variaciones() -> dict[str, float]:
    """Serie mensual (semilla + lo que traiga el BCRA, que pisa/extiende). Cacheada; ante falla, semilla."""
    global _cache_variaciones, _cache_ts
    ahora = time.monotonic()
    if _cache_variaciones is not None and (ahora - _cache_ts) < _TTL_SEGUNDOS:
        return _cache_variaciones
    serie = dict(_SEMILLA)
    try:
        serie.update(_traer_bcra())
    except Exception:
        # Falla transitoria de la fuente: nos quedamos con la semilla (y lo cacheado previo si había).
        if _cache_variaciones is not None:
            return _cache_variaciones
    _cache_variaciones = serie
    _cache_ts = ahora
    return serie


def _indice(serie: dict[str, float]) -> dict[str, float]:
    """Índice de nivel acumulado por mes (producto de (1 + var/100)). La base se cancela en el cociente."""
    indice: dict[str, float] = {}
    nivel = 1.0
    for mes in sorted(serie):
        nivel *= 1.0 + serie[mes] / 100.0
        indice[mes] = nivel
    return indice


def mes_referencia() -> str:
    """Último mes con IPC conocido: el mes al que deflactamos ("pesos de <este mes>")."""
    return max(_variaciones())


def coeficiente(mes_origen: str, mes_ref: Optional[str] = None) -> float:
    """Factor para llevar un importe del mes `mes_origen` ('aaaa-mm') a pesos de `mes_ref`
    (por defecto, el último mes con IPC). Meses posteriores al último IPC conocido (el mes en curso y
    el anterior, que todavía no se publicaron) se toman como ya expresados en pesos de referencia
    (factor 1): la distorsión de 1-2 meses es mínima y esto es una cifra de referencia. Meses previos
    al inicio de la serie se anclan al primero disponible."""
    indice = _indice(_variaciones())
    if not indice:
        return 1.0
    ref = mes_ref or max(indice)
    if mes_origen >= ref or mes_origen not in indice:
        return 1.0
    ref_nivel = indice.get(ref) or indice[max(indice)]
    return ref_nivel / indice[mes_origen]
