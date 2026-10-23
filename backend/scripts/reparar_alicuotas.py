"""
reparar_alicuotas.py — corrige el detalle por alícuota (alicuotas_json) de los comprobantes ya
guardados con el parseo viejo de Mis Comprobantes, SIN volver a consultarlos.

El parseo viejo (hasta oct-2026) barría una ventana corrida de la fila y deducía la tasa de iva/base:
  - el neto al 0% (y el 2,5%/5%) quedaba FUERA de la ventana → faltaba en el detalle, y el libro no
    sumaba (neto + IVA ≠ total en las facturas con dos actividades);
  - salían pares CRUZADOS (neto de una tasa con el IVA de la columna vecina) que pasaban por una
    tasa oficial, p. ej. un «2,5%» con base = IVA 21% e IVA = neto 10,5%.
Con lo guardado se puede reconstruir: un par cruzado repite importes de las columnas vecinas (su IVA
es la base de otro renglón, o su base es el IVA de otro / el neto total), y lo que falta para llegar
al neto total va al 0% si el IVA ya cuadra (o a 2,5%/5% si lo que falta tiene esa tasa). Lo que no
cierra se lista y se deja como está (lo arregla la próxima sincronización de ese período).

    cd backend
    .venv\\Scripts\\python -m scripts.reparar_alicuotas            # en seco: sólo informa
    .venv\\Scripts\\python -m scripts.reparar_alicuotas --aplicar  # guarda (respaldo antes en _bk_alicuotas_<fecha>)
"""
from __future__ import annotations

import datetime as dt
import json
import sys

from sqlalchemy import select, text

from app import models
from app.db import SessionLocal, engine

_TOL = 0.005
_TASAS_FALTANTES = (2.5, 5.0)


def _igual(a: float, b: float) -> bool:
    return abs(a - b) < 0.005


def _sospechoso(x: dict, otros: list[dict], neto: float) -> bool:
    """¿Puede ser un par cruzado? Repite un importe de las columnas vecinas: su IVA es la base de otro
    renglón, su base es el IVA de otro, o su base es el neto total."""
    if any(_igual(float(y["base"]), float(x["iva"])) or _igual(float(y["iva"]), float(x["base"])) for y in otros):
        return True
    return _igual(float(x["base"]), neto)


def _limpiar(alics: list[dict], neto: float, iva: float) -> list[dict] | None:
    """Los renglones reales: el subconjunto más grande con tasas distintas (cada columna aparece una
    vez), base ≤ neto total e IVA que cierra exacto con el total (el IVA de 10,5/21/27 siempre se leyó
    bien; lo que faltaba no tiene IVA o es de 2,5/5%), sacando sólo renglones sospechosos. Si hay más de
    un candidato del mismo tamaño, es ambiguo → None. Sin candidato con IVA exacto → el de IVA menor o
    igual más grande (lo que falta puede ser 2,5/5%)."""
    n = len(alics)
    candidatos: list[tuple[int, bool, list[dict]]] = []
    for mascara in range(1 << n):
        s = [alics[i] for i in range(n) if mascara >> i & 1]
        fuera = [alics[i] for i in range(n) if not mascara >> i & 1]
        tasas = [float(a["alicuota"]) for a in s]
        if len(set(tasas)) != len(tasas):
            continue
        if sum(float(a["base"]) for a in s) > neto + _TOL:
            continue
        resto_iva = iva - sum(float(a["iva"]) for a in s)
        if resto_iva < -_TOL:
            continue
        if not all(_sospechoso(x, [y for y in alics if y is not x], neto) for x in fuera):
            continue
        candidatos.append((len(s), abs(resto_iva) < _TOL, s))
    for exacto in (True, False):
        grupo = [c for c in candidatos if c[1] == exacto]
        if not grupo:
            continue
        mayor = max(c[0] for c in grupo)
        top = [c[2] for c in grupo if c[0] == mayor]
        return top[0] if len(top) == 1 else None
    return None


def reconstruir(alics: list[dict], neto: float, iva: float) -> tuple[list[dict] | None, str]:
    """(detalle corregido, motivo). None = no se puede cerrar sin volver a traerlo."""
    limpio = _limpiar(alics, neto, iva)
    if limpio is None:
        return None, "ambiguo"
    falta_base = round(neto - sum(float(a["base"]) for a in limpio), 2)
    falta_iva = round(iva - sum(float(a["iva"]) for a in limpio), 2)
    cruzados = len(alics) - len(limpio)
    if abs(falta_base) < _TOL and abs(falta_iva) < _TOL:
        return limpio, f"saca {cruzados} cruzado(s)" if cruzados else "ok"
    if falta_base > _TOL and abs(falta_iva) < _TOL:
        return [{"alicuota": 0.0, "base": falta_base, "iva": 0.0}, *limpio], "agrega 0%" + (
            f" y saca {cruzados} cruzado(s)" if cruzados else ""
        )
    if falta_base > _TOL and falta_iva > _TOL:
        r = falta_iva / falta_base * 100
        for t in _TASAS_FALTANTES:
            if abs(r - t) <= 0.3:
                nuevo = {"alicuota": t, "base": falta_base, "iva": falta_iva}
                return sorted([nuevo, *limpio], key=lambda a: float(a["alicuota"])), f"agrega {t:g}%"
    return None, f"no cierra (falta neto {falta_base}, IVA {falta_iva})"


def main() -> None:
    aplicar = "--aplicar" in sys.argv
    db = SessionLocal()
    try:
        comps = db.scalars(
            select(models.ComprobanteEmitido).where(models.ComprobanteEmitido.imp_neto.is_not(None))
        ).all()
        cambios: list[tuple[models.ComprobanteEmitido, str, str]] = []
        sin_cerrar: list[tuple[models.ComprobanteEmitido, str]] = []
        for c in comps:
            neto, iva = float(c.imp_neto or 0), float(c.imp_iva or 0)
            try:
                alics = json.loads(c.alicuotas_json) if c.alicuotas_json else []
            except ValueError:
                continue
            if not alics:
                # Todo al 0%: el parseo viejo no dejaba ningún renglón (neto gravado sin IVA).
                if neto > _TOL and abs(iva) < _TOL:
                    cambios.append((c, json.dumps([{"alicuota": 0.0, "base": round(neto, 2), "iva": 0.0}]), "todo 0%"))
                continue
            suma_b = sum(float(a["base"]) for a in alics)
            suma_i = sum(float(a["iva"]) for a in alics)
            if abs(neto - suma_b) < _TOL and abs(iva - suma_i) < _TOL:
                continue
            nuevo, motivo = reconstruir(alics, neto, iva)
            if nuevo is None:
                sin_cerrar.append((c, motivo))
            else:
                cambios.append((c, json.dumps(nuevo), motivo))

        resumen: dict[str, int] = {}
        for _, _, m in cambios:
            resumen[m] = resumen.get(m, 0) + 1
        print(f"Comprobantes con desglose: {len(comps)}")
        print(f"A corregir: {len(cambios)}  ·  sin cerrar: {len(sin_cerrar)}")
        for m, n in sorted(resumen.items(), key=lambda kv: -kv[1]):
            print(f"  {n:5d}  {m}")
        for c, nuevo, m in cambios[:15]:
            print(f"  {c.cuit} {c.direccion} {c.fecha} {c.cbte_tipo}-{c.punto_venta}-{c.numero}: {m}")
            print(f"      antes {c.alicuotas_json}\n      ahora {nuevo}")
        for c, m in sin_cerrar[:30]:
            print(f"  SIN CERRAR {c.cuit} {c.direccion} {c.fecha} {c.cbte_tipo}-{c.punto_venta}-{c.numero}: {m}  {c.alicuotas_json}")

        if not aplicar:
            print("\nEn seco: no se guardó nada. Correr con --aplicar para guardar.")
            return
        bk = f"_bk_alicuotas_{dt.date.today():%Y%m%d}"
        with engine.begin() as conn:
            conn.execute(text(f"CREATE TABLE IF NOT EXISTS {bk} (id INTEGER PRIMARY KEY, alicuotas_json TEXT)"))
            for c, _, _ in cambios:
                conn.execute(
                    text(f"INSERT INTO {bk} (id, alicuotas_json) VALUES (:id, :a) ON CONFLICT (id) DO NOTHING"),
                    {"id": c.id, "a": c.alicuotas_json},
                )
        for c, nuevo, _ in cambios:
            c.alicuotas_json = nuevo
        db.commit()
        print(f"\nGuardado: {len(cambios)} comprobantes. Respaldo del valor anterior en {bk}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
