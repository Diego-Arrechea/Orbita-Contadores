"""Importa el borrador del Libro IVA Digital de AFIP (los CSV que se descargan del Portal IVA) para
traer las PERCEPCIONES SEPARADAS por tipo (percepción IVA / IIBB / municipal / otros), que Mis
Comprobantes NO expone (sólo da el total lumpeado). Se matchea por (tipo, punto de venta, número) con
los comprobantes ya cacheados y se guarda el desglose en `percepciones_json`.

Acepta el ZIP que baja AFIP (con comprobantes_ventas.csv + comprobantes_compras.csv) o un CSV suelto.
Formato AFIP: separador ';', latin-1, importes en formato AR ('145288,10'). Ver la memoria
`lid-portal-integracion` y `modulo-iva-nacional-sistema`.
"""
from __future__ import annotations

import csv
import io
import json
import unicodedata
import zipfile

from sqlalchemy import select

from .. import models


def _norm(s: str) -> str:
    """Minúsculas sin acentos, para matchear encabezados de forma robusta."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().lower()


def _num(s: str) -> float:
    """Importe AR ('145288,10' / '1.234,50') -> float. '' -> 0.0."""
    s = (s or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_csv(texto: str) -> tuple[str, list[dict]]:
    """Parsea un CSV del borrador. Devuelve (direccion, filas) donde direccion es 'emitido' (ventas)
    o 'recibido' (compras) según el encabezado, y cada fila = {cbte_tipo, punto_venta, numero,
    percepciones{...}}."""
    filas_raw = list(csv.reader(texto.splitlines(), delimiter=";", quotechar='"'))
    if not filas_raw:
        return "", []
    heads = [_norm(h) for h in filas_raw[0]]
    direccion = "recibido" if any("vendedor" in h for h in heads) else "emitido"

    def col(*keywords: str, excluir: str = "") -> int | None:
        for i, h in enumerate(heads):
            if all(k in h for k in keywords) and (not excluir or excluir not in h):
                return i
        return None

    i_tipo = col("tipo de comprobante")
    i_pv = col("punto de venta")
    i_num = col("numero de comprobante", excluir="hasta")
    i_iva = col("percep", "iva")           # "Percepciones o Pagos a Cuenta de IVA"
    i_iibb = col("percep", "ingresos brutos")
    i_muni = col("impuestos municipales")
    i_int = col("impuestos internos")
    i_nac = col("otros imp")               # "Otros Imp. Nac."
    i_otros = col("otros tributos")
    i_nocat = col("no categorizados")

    def val(fila: list[str], idx: int | None) -> float:
        return _num(fila[idx]) if idx is not None and idx < len(fila) else 0.0

    out: list[dict] = []
    for fila in filas_raw[1:]:
        if not fila or i_tipo is None or i_tipo >= len(fila) or not fila[i_tipo].strip():
            continue
        try:
            tipo = int(fila[i_tipo]); pv = int(fila[i_pv]); numero = int(fila[i_num])
        except (ValueError, TypeError):
            continue
        out.append({
            "cbte_tipo": tipo, "punto_venta": pv, "numero": numero,
            "percepciones": {
                "iva": val(fila, i_iva), "iibb": val(fila, i_iibb),
                "muni": val(fila, i_muni), "internos": val(fila, i_int),
                "otros_nac": val(fila, i_nac), "otros": val(fila, i_otros),
                "no_categ": val(fila, i_nocat),
            },
        })
    return direccion, out


def parsear_borrador(contenido: bytes) -> dict[str, list[dict]]:
    """Del ZIP o CSV subido -> {'emitido': [...], 'recibido': [...]}."""
    res: dict[str, list[dict]] = {"emitido": [], "recibido": []}
    csvs: list[str] = []
    if contenido[:2] == b"PK":  # ZIP
        z = zipfile.ZipFile(io.BytesIO(contenido))
        for n in z.namelist():
            if n.lower().endswith(".csv"):
                csvs.append(z.read(n).decode("latin-1", "replace"))
    else:
        csvs.append(contenido.decode("latin-1", "replace"))
    for texto in csvs:
        direccion, filas = _parse_csv(texto)
        if direccion:
            res[direccion].extend(filas)
    return res


def importar(db, cuit: str, contenido: bytes) -> dict:
    """Parsea el borrador y guarda las percepciones separadas en los comprobantes del cliente
    (match por tipo/PV/número/dirección). Devuelve {actualizados, sin_match, total}."""
    data = parsear_borrador(contenido)
    actualizados = 0
    sin_match = 0
    total = 0
    for direccion, filas in data.items():
        for f in filas:
            total += 1
            comp = db.scalar(
                select(models.ComprobanteEmitido).where(
                    models.ComprobanteEmitido.cuit == cuit,
                    models.ComprobanteEmitido.direccion == direccion,
                    models.ComprobanteEmitido.punto_venta == f["punto_venta"],
                    models.ComprobanteEmitido.cbte_tipo == f["cbte_tipo"],
                    models.ComprobanteEmitido.numero == f["numero"],
                )
            )
            if comp is None:
                sin_match += 1
                continue
            p = {k: round(v, 2) for k, v in f["percepciones"].items()}
            comp.percepciones_json = json.dumps(p)
            actualizados += 1
    db.commit()
    return {"actualizados": actualizados, "sin_match": sin_match, "total": total}
