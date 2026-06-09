"""
verificar_export_arca.py — Verifica la valuación de comprobantes en moneda extranjera (Factura E)
contra el facturómetro oficial de ARCA.

Hallazgo que motivó el script: ARCA valúa las exportaciones en USD al "dólar tarjeta" del día
(= dólar oficial BNA × 1,30), NO a la cotización declarada en el comprobante. Este script revalúa
los emitidos en USD usando el dólar tarjeta histórico (api.argentinadatos.com) y compara la suma de
los últimos 12 meses contra `clientes_arca.facturacion_12m` (el facturómetro oficial) para ver si
coinciden.

    cd backend
    .venv\\Scripts\\python -m scripts.verificar_export_arca <cuit>

Sólo lectura: NO escribe en la base. Es una herramienta de diagnóstico/validación.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import urllib.request

from sqlalchemy import select

from app import models
from app.db import SessionLocal
from app.schemas import TIPO_COMPROBANTE

API = "https://api.argentinadatos.com/v1/cotizaciones/dolares/tarjeta/{y:04d}/{m:02d}/{d:02d}"
NC_TIPOS = {3, 8, 13, 21, 53, 114, 112, 113, 203, 208, 213}  # notas de crédito (restan)


def _tarjeta_venta(fecha: dt.date) -> tuple[float, dt.date]:
    """Dólar tarjeta (venta) de `fecha`; si no hay (finde/feriado) retrocede hasta 6 días hábiles.
    Devuelve (cotizacion, fecha_efectiva)."""
    for i in range(7):
        f = fecha - dt.timedelta(days=i)
        url = API.format(y=f.year, m=f.month, d=f.day)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                j = json.load(r)
            if j.get("venta"):
                return float(j["venta"]), f
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError(f"Sin cotización de dólar tarjeta cerca de {fecha}")


def main() -> None:
    cuit = "".join(c for c in sys.argv[1] if c.isdigit())
    db = SessionLocal()
    cli = db.get(models.ClienteARCA, cuit)
    if cli is None or cli.facturacion_12m is None:
        raise SystemExit(f"{cuit}: sin facturómetro oficial de ARCA en la base.")
    arca = float(cli.facturacion_12m)  # Numeric(Decimal) -> float para operar con las revaluaciones

    # Ventana: 12 meses calendario terminando en la fecha de corte del facturómetro (dd/mm/aaaa).
    corte = dt.datetime.strptime(cli.facturometro_actualizado, "%d/%m/%Y").date()
    desde = dt.date(corte.year - 1, corte.month, 1)

    rows = db.scalars(
        select(models.ComprobanteEmitido).where(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.direccion == "emitido",
            models.ComprobanteEmitido.fecha >= desde,
            models.ComprobanteEmitido.fecha <= corte,
        ).order_by(models.ComprobanteEmitido.fecha)
    ).all()
    db.close()

    print(f"Cliente {cli.nombre} ({cuit})")
    print(f"Ventana facturómetro: {desde} .. {corte}   |   ARCA oficial: {arca:,.2f}\n")

    total_decl = 0.0   # como lo calculamos hoy (cotización declarada en el comprobante)
    total_arca = 0.0   # revaluando exports al dólar tarjeta
    print(f"{'fecha':10} {'tipo':22} {'moneda':6} {'origen':>12} {'declarado':>14} {'tarjeta':>9} {'revaluado':>14}")
    for c in rows:
        signo = -1 if c.cbte_tipo in NC_TIPOS else 1
        decl = signo * float(c.imp_total)
        tipo = TIPO_COMPROBANTE.get(c.cbte_tipo, f"tipo {c.cbte_tipo}")
        if (c.moneda or "ARS") != "ARS":
            cot, fef = _tarjeta_venta(c.fecha)
            reval = signo * float(c.imp_total_origen) * cot
            tag = f"{cot:>9}"
            if fef != c.fecha:
                tag += f"({fef})"
        else:
            reval = decl
            cot, tag = None, f"{'-':>9}"
        total_decl += decl
        total_arca += reval
        print(f"{str(c.fecha):10} {tipo:22} {c.moneda or 'ARS':6} {float(c.imp_total_origen):>12,.2f} {decl:>14,.2f} {tag} {reval:>14,.2f}")

    print("\n" + "=" * 70)
    print(f"  Total como lo calculamos hoy (cotización declarada):  {total_decl:>16,.2f}")
    print(f"  Total revaluando exports a dólar tarjeta:             {total_arca:>16,.2f}")
    print(f"  Facturómetro oficial ARCA:                            {arca:>16,.2f}")
    print(f"  Residual (ARCA − revaluado):                          {arca - total_arca:>+16,.2f}")
    pct = (arca - total_arca) / arca * 100 if arca else 0
    print(f"  Residual %:                                           {pct:>+15.3f}%")


if __name__ == "__main__":
    main()
