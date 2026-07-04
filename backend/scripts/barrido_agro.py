"""
barrido_agro.py — barrida de detección de Facturación Agropecuaria (gentil + resumible).

Recorre los clientes y, por cada uno, consulta las Liquidaciones Electrónicas del sector primario
(agro). Si el cliente TIENE liquidaciones, prende su flag `factura_agro` y cachea las liquidaciones
(con su Importe Bruto). Así queda verificado en toda la cartera a quién le aplica sin que el
contador tenga que saberlo de antemano.

Ojo — el host de las liquidaciones (`serviciosjava2`, lsp-web) tiene un WAF que soft-bloquea la IP
ante mucho volumen (devuelve páginas en blanco → la sesión no se establece). Por eso la barrida:
  - PACEA con jitter grande entre clientes,
  - SALTEA a los ya marcados (`factura_agro=true`): re-correr es incremental,
  - ABORTA sola si detecta N bloqueos seguidos (la IP quedó rate-limited) e imprime desde dónde
    reanudar, en vez de seguir golpeando y registrar falsos "sin liquidaciones".

    cd backend
    .venv\\Scripts\\python -m scripts.barrido_agro                 # cartera sin marcar
    .venv\\Scripts\\python -m scripts.barrido_agro --desde=<cuit>  # reanudar tras un corte
    .venv\\Scripts\\python -m scripts.barrido_agro <cuit> [<cuit>] # sólo esos clientes

Por ahora sólo detecta el sector 'hacienda' (Hacienda y Carne / Sector Pecuario), el único mapeado
end-to-end. Ver la memoria `facturacion-agropecuaria`.
"""
from __future__ import annotations

import random
import sys
import time

from sqlalchemy import select

from app import models
from app.db import SessionLocal
from app.services import agro

SECTOR = "hacienda"
PAUSA_MIN, PAUSA_MAX = 8.0, 14.0        # s entre clientes (jitter anti rate-limit del WAF)
CORTE_BLOQUEO = 4                       # bloqueos de sesión SEGUIDOS → abortar (IP rate-limited)
MARCADORES_BLOQUEO = ("grilla no cargó", "sesión no establecida")


def _es_bloqueo(msg: str) -> bool:
    return any(m in msg for m in MARCADORES_BLOQUEO)


def _parse_args(argv: list[str]) -> tuple[list[str], str | None]:
    cuits, desde = [], None
    for a in argv:
        if a.startswith("--desde="):
            desde = "".join(c for c in a.split("=", 1)[1] if c.isdigit()) or None
        else:
            d = "".join(c for c in a if c.isdigit())
            if len(d) == 11:
                cuits.append(d)
    return cuits, desde


def _cuits_objetivo(db, cuits: list[str], desde: str | None) -> list[str]:
    if cuits:
        return cuits
    q = (
        select(models.ClienteARCA.cuit)
        .where(
            models.ClienteARCA.cuit_credencial.isnot(None),
            models.ClienteARCA.factura_agro.is_(False),  # los ya detectados se saltean
        )
        .order_by(models.ClienteARCA.cuit)
    )
    if desde:
        q = q.where(models.ClienteARCA.cuit > desde)
    return list(db.scalars(q))


def main() -> None:
    cuits_arg, desde = _parse_args(sys.argv[1:])
    db = SessionLocal()
    try:
        cuits = _cuits_objetivo(db, cuits_arg, desde)
        total = len(cuits)
        cab = f"Barrida agro ({SECTOR}) sobre {total} cliente(s) sin marcar"
        print(cab + (f" (desde {desde})" if desde else "") + "\n")

        con_agro: list[tuple[str, dict]] = []
        errores: list[tuple[str, str]] = []
        bloqueos_seguidos = 0
        ultimo_ok = desde  # desde dónde reanudar si se aborta (último cliente ya resuelto)
        abortado = False
        for i, cuit in enumerate(cuits, 1):
            cli = db.get(models.ClienteARCA, cuit)
            nombre = cli.nombre if cli else "?"
            print(f"[{i}/{total}] {cuit} {nombre[:38]:38} … ", end="", flush=True)
            try:
                # DETECCIÓN: sin bajar PDFs (grilla nomás) → liviano, no gatilla el WAF. El importe
                # de los que resulten agropecuarios se llena después con una corrida con_importe=True.
                res = agro.sincronizar_agro(db, cuit, sector=SECTOR, marcar_flag=True, con_importe=False)
            except Exception as e:  # noqa: BLE001
                db.rollback()
                msg = str(e).splitlines()[0][:130]
                errores.append((cuit, msg))
                if _es_bloqueo(msg):
                    bloqueos_seguidos += 1
                    print(f"BLOQUEO ({bloqueos_seguidos}/{CORTE_BLOQUEO})")
                    if bloqueos_seguidos >= CORTE_BLOQUEO:
                        abortado = True
                        break
                else:  # clave inválida / cambio forzado / etc.: cliente resuelto, seguimos
                    bloqueos_seguidos = 0
                    ultimo_ok = cuit
                    print(f"ERROR: {msg}")
            else:
                bloqueos_seguidos = 0
                ultimo_ok = cuit
                if res["tiene"]:
                    con_agro.append((cuit, res))
                    tot = res["total_bruto"]
                    imp = f"${tot:,.2f}" if tot else "importe pendiente"
                    print(f"AGRO ✓  {res['procesadas']} liq · {imp}")
                else:
                    print("sin liquidaciones")
            time.sleep(random.uniform(PAUSA_MIN, PAUSA_MAX))

        print("\n" + "=" * 60)
        if abortado:
            print(f"⛔ {CORTE_BLOQUEO} bloqueos seguidos: la IP quedó rate-limited en serviciosjava2.")
            print(f"   Esperá un rato y reanudá con:  --desde={ultimo_ok or ''}")
        con_bloqueo = sum(1 for _, m in errores if _es_bloqueo(m))
        otros_err = [(c, m) for c, m in errores if not _es_bloqueo(m)]
        print(f"CON facturación agropecuaria (esta corrida): {len(con_agro)}")
        for cuit, res in con_agro:
            cli = db.get(models.ClienteARCA, cuit)
            tot = res["total_bruto"]
            imp = f"${tot:,.2f}" if tot else "(importe pendiente)"
            print(f"  {cuit} {cli.nombre[:36]:36} {res['procesadas']:>4} liq  {imp}")
        if errores:
            print(f"\nErrores: {len(errores)} (bloqueo: {con_bloqueo}, otros: {len(otros_err)})")
            for cuit, msg in otros_err[:25]:
                print(f"  {cuit}: {msg}")
        print(f"\nÚltimo cliente resuelto: {ultimo_ok}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
