"""
debug_sync.py — re-sincroniza UN cliente con trazabilidad COMPLETA e imprime cada paso en vivo.

Pensado para diagnosticar fallos de sincronización: corre 'Mis Comprobantes' del CUIT, imprime la
traza paso a paso (fase + URL + tiempo) a medida que avanza y, al terminar (o fallar), deja en
backend/data/diag/:
  - traza_<cuit>.json          → la lista de pasos (qué hizo y dónde quedó)
  - fallo_<cuit>_<n>.png/html  → screenshot + HTML de la pantalla donde quedó (sólo si falló)
  - trace_<cuit>.zip           → traza visual de Patchright; abrir con:  playwright show-trace <zip>

    cd backend
    .venv\\Scripts\\python -m scripts.debug_sync <cuit>

Hace una sincronización incremental normal (la fila en 'extracciones' queda registrada igual que una
sync real, así el motivo enriquecido aparece también en el panel). La trazabilidad se controla con
SCRAPING_TRAZAS (default true), por lo que este script la usa sin configuración extra.
"""
from __future__ import annotations

import sys

from app import models
from app.config import BASE_DIR
from app.db import SessionLocal
from app.services import sincronizacion


def _progreso(paso: int, total: int, mensaje: str) -> None:
    print(f"  [{paso}/{total}] {mensaje}", flush=True)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python -m scripts.debug_sync <cuit>")
    cuit = "".join(c for c in sys.argv[1] if c.isdigit())
    if len(cuit) != 11:
        raise SystemExit(f"CUIT inválido: {sys.argv[1]!r} (tienen que ser 11 dígitos).")

    db = SessionLocal()
    try:
        cliente = db.get(models.ClienteARCA, cuit)
        if cliente is None:
            raise SystemExit(f"No hay ningún cliente con CUIT {cuit} en la base.")
        print(f"Cliente: {cliente.nombre} ({cuit})")
        print("Sincronizando con trazabilidad (cada paso se imprime con [traza +Nms])…\n")
        try:
            nuevos = sincronizacion.sincronizar(db, cuit, on_progress=_progreso)
            print(f"\n✅ OK: {nuevos} comprobantes nuevos.")
        except Exception as e:  # noqa: BLE001 — queremos VER el error, no que aborte el script
            print(f"\n❌ Falló en: {e}")
        diag = BASE_DIR / "data" / "diag"
        print(f"\nArtefactos de diagnóstico en: {diag}")
        print(f"  traza_{cuit}.json  |  fallo_{cuit}_*.png/html  |  trace_{cuit}.zip")
        print(f"  Ver la traza visual:  playwright show-trace {diag / f'trace_{cuit}.zip'}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
