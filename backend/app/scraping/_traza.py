"""
Trazabilidad del scraping: registra cada PASO (fase + URL + tiempo relativo) de una corrida para
saber EXACTAMENTE dónde cayó un fallo. El detalle visual fino (screenshot + DOM por acción) queda
en el `trace.zip` de Patchright; esto es el resumen liviano que además se inyecta en el `motivo`
del fallo (lo que se ve en el panel superadmin) y se vuelca a `data/diag/traza_<cuit>.json`.
"""
from __future__ import annotations

import time


class Traza:
    """Acumulador de pasos de una corrida de scraping. `fase` siempre tiene la última etapa
    arrancada, así al cazar la excepción sabemos en qué paso reventó sin instrumentar cada línea."""

    def __init__(self, etiqueta: str = "") -> None:
        self.etiqueta = etiqueta
        self.fase = "inicio"
        self.pasos: list[dict] = []
        self._t0 = time.monotonic()

    def paso(self, fase: str, page=None) -> None:
        """Marca el comienzo de una etapa. `page` es opcional: si viene, anota su URL actual
        (sin colgar si la página ya se cerró)."""
        self.fase = fase
        ms = int((time.monotonic() - self._t0) * 1000)
        url = ""
        try:
            if page is not None:
                url = page.url
        except Exception:  # noqa: BLE001
            url = ""
        self.pasos.append({"ms": ms, "fase": fase, "url": url})
        print(f"  [traza +{ms}ms] {fase}" + (f"  ({url})" if url else ""), flush=True)

    def resumen(self) -> str:
        """Las fases en orden, para un log de una línea."""
        return " → ".join(p["fase"] for p in self.pasos)
