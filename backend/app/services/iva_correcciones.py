"""Correcciones manuales del contador sobre los comprobantes del Libro IVA (modelo `IvaCorreccion`).

El sync reescribe `ComprobanteEmitido` en cada corrida, así que las correcciones viven aparte y se
aplican al LEER: `efectivos()` devuelve, por cada comprobante, una copia liviana con los valores ya
corregidos y los mismos atributos que usan el libro, la posición, el export LID y el PDF (duck
typing: esas funciones no distinguen un comprobante corregido de uno original).

Qué se puede corregir (pedido de los contadores, reunión 1-oct-2026):
- la alícuota de IVA (detalle por alícuota; el IVA se recalcula como base × tasa),
- la letra A↔B (cambia el cbte_tipo por su par de la otra clase),
- no gravado / exento,
- el reparto de "otros tributos" en percepción IVA / IIBB / municipales / impuestos internos / otros,
- excluir el comprobante (no corresponde al negocio): sigue listado en el libro pero no suma.

El total se recalcula por diferencia: total original + (cada concepto nuevo − el original), tomando
como original lo que muestra el libro (sin desglose capturado = todo el total como neto)."""
from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

ALICUOTAS_VALIDAS = (0.0, 2.5, 5.0, 10.5, 21.0, 27.0)
PERCEP_CAMPOS = ("iva", "iibb", "muni", "internos", "otros_nac", "otros", "no_categ")

# Par de la otra clase para el cambio de letra A↔B (factura, ND, NC, recibo, FCE y tiques).
_PARES_AB = {1: 6, 2: 7, 3: 8, 4: 9, 201: 206, 202: 207, 203: 208, 81: 82, 112: 113, 115: 116}
PAR_LETRA: dict[int, int] = {**_PARES_AB, **{b: a for a, b in _PARES_AB.items()}}

_ATRIBUTOS = (
    "id", "cuit", "direccion", "cbte_tipo", "punto_venta", "numero", "fecha", "imp_total",
    "moneda", "cotizacion", "imp_neto", "imp_iva", "imp_no_gravado", "imp_exento", "imp_trib",
    "alicuotas_json", "percepciones_json", "doc_nro", "contraparte_nombre",
)


def clave_comprobante(c) -> str:
    """Id compuesto estable de un comprobante (con su cbte_tipo ORIGINAL). Es el `id` de la línea del
    libro y el `comprobanteId` de las revisiones sugeridas."""
    tipo = getattr(c, "cbte_tipo_original", c.cbte_tipo)
    return f"{c.cuit}-{c.direccion}-{c.punto_venta}-{tipo}-{c.numero}"


def _json(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _f(v) -> float:
    return float(v or 0)


def valores_mostrados(c) -> dict:
    """Importes del comprobante tal como los muestra el libro: sin desglose capturado (clase B/C o
    datos viejos) el total va como neto y el resto en 0."""
    total = _f(c.imp_total)
    if c.imp_neto is None and c.imp_iva is None:
        return {"neto": total, "iva": 0.0, "noGravado": 0.0, "exento": 0.0, "tributos": 0.0,
                "total": total}
    return {
        "neto": _f(c.imp_neto), "iva": _f(c.imp_iva), "noGravado": _f(c.imp_no_gravado),
        "exento": _f(c.imp_exento), "tributos": _f(c.imp_trib), "total": total,
    }


def aplicar(c: models.ComprobanteEmitido, corr: models.IvaCorreccion | None) -> SimpleNamespace:
    """Copia del comprobante con la corrección aplicada (o idéntica si no hay corrección)."""
    e = SimpleNamespace(**{a: getattr(c, a) for a in _ATRIBUTOS})
    e.cbte_tipo_original = c.cbte_tipo
    e.corregido = False
    e.excluido = False
    e.nota = None
    e.original = valores_mostrados(c)
    if corr is None:
        return e

    e.excluido = bool(corr.excluido)
    e.nota = corr.nota
    orig = e.original
    neto, iva = orig["neto"], orig["iva"]
    nog, exe, trib = orig["noGravado"], orig["exento"], orig["tributos"]
    toco_importes = False

    if corr.cbte_tipo_nuevo is not None:
        e.cbte_tipo = corr.cbte_tipo_nuevo
        e.corregido = True
    alics = _json(corr.alicuotas_json)
    if alics is not None:
        e.alicuotas_json = corr.alicuotas_json
        neto = round(sum(_f(a["base"]) for a in alics), 2)
        iva = round(sum(_f(a["iva"]) for a in alics), 2)
        toco_importes = True
    if corr.imp_no_gravado is not None:
        nog = _f(corr.imp_no_gravado)
        toco_importes = True
    if corr.imp_exento is not None:
        exe = _f(corr.imp_exento)
        toco_importes = True
    percep = _json(corr.percepciones_json)
    if percep is not None:
        e.percepciones_json = corr.percepciones_json
        trib = round(sum(_f(percep.get(k)) for k in PERCEP_CAMPOS), 2)
        toco_importes = True

    if toco_importes:
        e.corregido = True
        e.imp_neto, e.imp_iva, e.imp_no_gravado, e.imp_exento, e.imp_trib = neto, iva, nog, exe, trib
        e.imp_total = round(
            orig["total"]
            + (neto - orig["neto"]) + (iva - orig["iva"]) + (nog - orig["noGravado"])
            + (exe - orig["exento"]) + (trib - orig["tributos"]),
            2,
        )
    return e


def _clave_corr(cuit: str, direccion: str, pv: int, tipo: int, numero: int) -> tuple:
    return (cuit, direccion, pv, tipo, numero)


def efectivos(db: Session, comps: list[models.ComprobanteEmitido]) -> list[SimpleNamespace]:
    """Aplica las correcciones guardadas a una lista de comprobantes (una sola consulta por cliente)."""
    if not comps:
        return []
    cuits = {c.cuit for c in comps}
    corrs = db.scalars(
        select(models.IvaCorreccion).where(models.IvaCorreccion.cuit.in_(cuits))
    ).all()
    por_clave = {
        _clave_corr(k.cuit, k.direccion, k.punto_venta, k.cbte_tipo, k.numero): k for k in corrs
    }
    return [
        aplicar(c, por_clave.get(_clave_corr(c.cuit, c.direccion, c.punto_venta, c.cbte_tipo, c.numero)))
        for c in comps
    ]


def buscar(db: Session, c: models.ComprobanteEmitido) -> models.IvaCorreccion | None:
    return db.scalar(
        select(models.IvaCorreccion).where(
            models.IvaCorreccion.cuit == c.cuit,
            models.IvaCorreccion.direccion == c.direccion,
            models.IvaCorreccion.punto_venta == c.punto_venta,
            models.IvaCorreccion.cbte_tipo == c.cbte_tipo,
            models.IvaCorreccion.numero == c.numero,
        )
    )


def guardar(
    db: Session,
    c: models.ComprobanteEmitido,
    *,
    cbte_tipo: int | None,
    alicuotas: list[dict] | None,
    no_gravado: float | None,
    exento: float | None,
    percepciones: dict | None,
    excluido: bool,
    nota: str | None,
    usuario_id: int | None,
) -> models.IvaCorreccion | None:
    """Valida y guarda (upsert) la corrección de un comprobante. Si no queda nada corregido, la borra
    (vuelve al original) y devuelve None. Lanza ValueError con copy de dominio si algo no es válido."""
    if cbte_tipo is not None and cbte_tipo != c.cbte_tipo and PAR_LETRA.get(c.cbte_tipo) != cbte_tipo:
        raise ValueError("Ese comprobante no admite el cambio de letra pedido.")
    if cbte_tipo == c.cbte_tipo:
        cbte_tipo = None

    alics_json = None
    if alicuotas is not None:
        filas = []
        for a in alicuotas:
            tasa = round(float(a["alicuota"]), 2)
            base = round(float(a["base"]), 2)
            if tasa not in ALICUOTAS_VALIDAS:
                raise ValueError(f"La alícuota {tasa:g}% no es una alícuota de IVA vigente.")
            if base < 0:
                raise ValueError("El neto gravado no puede ser negativo.")
            if base == 0:
                continue
            filas.append({"alicuota": tasa, "base": base, "iva": round(base * tasa / 100, 2)})
        alics_json = json.dumps(filas)

    for nombre, v in (("no gravado", no_gravado), ("exento", exento)):
        if v is not None and v < 0:
            raise ValueError(f"El importe {nombre} no puede ser negativo.")

    percep_json = None
    if percepciones is not None:
        p = {}
        for k in PERCEP_CAMPOS:
            v = round(float(percepciones.get(k) or 0), 2)
            if v < 0:
                raise ValueError("Las percepciones no pueden ser negativas.")
            p[k] = v
        percep_json = json.dumps(p)

    nota = (nota or "").strip() or None
    corr = buscar(db, c)
    vacia = (
        cbte_tipo is None and alics_json is None and no_gravado is None and exento is None
        and percep_json is None and not excluido and nota is None
    )
    if vacia:
        if corr is not None:
            db.delete(corr)
            db.commit()
        return None

    if corr is None:
        corr = models.IvaCorreccion(
            cuit=c.cuit, direccion=c.direccion, punto_venta=c.punto_venta,
            cbte_tipo=c.cbte_tipo, numero=c.numero,
        )
        db.add(corr)
    corr.cbte_tipo_nuevo = cbte_tipo
    corr.alicuotas_json = alics_json
    corr.imp_no_gravado = no_gravado
    corr.imp_exento = exento
    corr.percepciones_json = percep_json
    corr.excluido = excluido
    corr.nota = nota
    corr.usuario_id = usuario_id
    corr.actualizado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return corr


def percepciones_de(e) -> dict:
    """Percepciones por tipo de un comprobante (efectivo). Sin desglose importado: el total lumpeado
    (imp_trib) va en 'otros' — mismo criterio que el export LID, para no sobre-declarar percepción IVA."""
    p = _json(e.percepciones_json)
    if p:
        return {k: _f(p.get(k)) for k in PERCEP_CAMPOS}
    trib = _f(e.imp_trib) if not (e.imp_neto is None and e.imp_iva is None) else 0.0
    return {k: (trib if k == "otros" else 0.0) for k in PERCEP_CAMPOS}


def alicuotas_de(e) -> list[dict]:
    return _json(e.alicuotas_json) or []
