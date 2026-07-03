"""
barrido_agro.py — barrida ÚNICA de detección de Facturación Agropecuaria.

Recorre los clientes y, por cada uno, consulta las Liquidaciones Electrónicas del sector primario
(agro). Si el cliente TIENE liquidaciones, prende su flag `factura_agro` y cachea las liquidaciones
(con su Importe Bruto). Así queda verificado en toda la cartera a quién le aplica esto sin que el
contador tenga que saberlo de antemano. Idempotente: se puede re-correr (deduplica por liq_id).

    cd backend
    .venv\\Scripts\\python -m scripts.barrido_agro                 # toda la cartera
    .venv\\Scripts\\python -m scripts.barrido_agro <cuit> [<cuit>] # sólo esos clientes

Por ahora sólo detecta el sector 'hacienda' (Hacienda y Carne / Sector Pecuario), el único mapeado
end-to-end. Ver la memoria `facturacion-agropecuaria`.
"""
from __future__ import annotations

import sys
import time

from sqlalchemy import select

from app import models
from app.db import SessionLocal
from app.services import agro

SECTOR = "hacienda"
PAUSA_ENTRE_CLIENTES = 2.0  # s: gentileza con ARCA (la barrida no tiene apuro)


def _cuits_objetivo(db, args: list[str]) -> list[str]:
    if args:
        pedidos = ["".join(c for c in a if c.isdigit()) for a in args]
        return [c for c in pedidos if len(c) == 11]
    # Toda la cartera con credencial cargada (sin credencial no se puede consultar).
    return list(
        db.scalars(
            select(models.ClienteARCA.cuit)
            .where(models.ClienteARCA.cuit_credencial.isnot(None))
            .order_by(models.ClienteARCA.cuit)
        )
    )


def main() -> None:
    db = SessionLocal()
    try:
        cuits = _cuits_objetivo(db, sys.argv[1:])
        total = len(cuits)
        print(f"Barrida de Facturación Agropecuaria ({SECTOR}) sobre {total} cliente(s)\n")

        con_agro: list[tuple[str, dict]] = []
        errores: list[tuple[str, str]] = []
        for i, cuit in enumerate(cuits, 1):
            cli = db.get(models.ClienteARCA, cuit)
            nombre = cli.nombre if cli else "?"
            print(f"[{i}/{total}] {cuit} {nombre[:40]:40} … ", end="", flush=True)
            try:
                res = agro.sincronizar_agro(db, cuit, sector=SECTOR, marcar_flag=True)
            except Exception as e:  # noqa: BLE001  (un cliente que falla no corta la barrida)
                db.rollback()
                msg = str(e).splitlines()[0][:120]
                errores.append((cuit, msg))
                print(f"ERROR: {msg}")
            else:
                if res["tiene"]:
                    con_agro.append((cuit, res))
                    extra = f" · {res['sin_importe']} sin importe" if res["sin_importe"] else ""
                    print(
                        f"AGRO ✓  {res['procesadas']} liq (nuevas {res['nuevas']}) "
                        f"total ${res['total_bruto']:,.2f}{extra}"
                    )
                else:
                    print("sin liquidaciones")
            time.sleep(PAUSA_ENTRE_CLIENTES)

        print("\n" + "=" * 60)
        print(f"CON facturación agropecuaria: {len(con_agro)}/{total}")
        for cuit, res in con_agro:
            cli = db.get(models.ClienteARCA, cuit)
            print(f"  {cuit} {cli.nombre[:38]:38} {res['procesadas']:>4} liq  ${res['total_bruto']:,.2f}")
        if errores:
            print(f"\nErrores: {len(errores)}")
            for cuit, msg in errores:
                print(f"  {cuit}: {msg}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
