"""
resync_cliente.py — borra el cache de comprobantes de un cliente y re-sincroniza su histórico
COMPLETO desde 'Mis Comprobantes'.

Sirve para recalcular comprobantes YA guardados cuando cambió la forma de procesarlos. Caso de uso
que motivó el script: una Factura E de exportación había quedado guardada en dólares; tras agregar
el manejo de moneda/cotización, este script vuelve a traer todo y la consolida en pesos. Al vaciar
el cache, la sincronización deja de ser incremental y re-trae el histórico entero (recalculando
imp_total = imp_total_origen × cotizacion).

    cd backend
    .venv\\Scripts\\python -m scripts.resync_cliente <cuit>

El borrado y la re-sincronización son ATÓMICOS (un flush, no un commit): si la sync falla, su
rollback revierte también el borrado, así el cliente nunca queda sin comprobantes. Los movimientos
bancarios y sus matches NO se tocan: el id de comprobante (cuit-direccion-pv-tipo-numero) es
estable, así que tras el re-sync los matches siguen apuntando al mismo comprobante.
"""
from __future__ import annotations

import sys

from sqlalchemy import delete

from app import models
from app.db import SessionLocal
from app.services import sincronizacion


def _progreso(paso: int, total: int, mensaje: str) -> None:
    print(f"  [{paso}/{total}] {mensaje}")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python -m scripts.resync_cliente <cuit>")
    cuit = "".join(c for c in sys.argv[1] if c.isdigit())
    if len(cuit) != 11:
        raise SystemExit(f"CUIT inválido: {sys.argv[1]!r} (tienen que ser 11 dígitos).")

    db = SessionLocal()
    try:
        cliente = db.get(models.ClienteARCA, cuit)
        if cliente is None:
            raise SystemExit(f"No hay ningún cliente con CUIT {cuit} en la base.")
        print(f"Cliente: {cliente.nombre} ({cuit})")

        borrados = db.execute(
            delete(models.ComprobanteEmitido).where(models.ComprobanteEmitido.cuit == cuit)
        ).rowcount
        # flush (no commit): el borrado queda visible para la sync (misma sesión) pero dentro de la
        # misma transacción, así que un fallo de la sync lo revierte junto con todo lo demás.
        db.flush()
        print(f"Cache vaciado ({borrados} comprobantes). Re-sincronizando histórico completo…")

        total = sincronizacion.sincronizar(db, cuit, on_progress=_progreso)
        print(f"\n✅ Listo: {total} comprobantes re-sincronizados (imp_total recalculado en pesos).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
