"""
Conciliación bancaria REAL: cruza las acreditaciones de un extracto bancario / export de billetera
(MercadoPago, etc.) contra los comprobantes EMITIDOS reales del cliente (cache de Mis Comprobantes).

El front parsea el archivo y manda las filas YA normalizadas; acá filtramos a acreditaciones,
deduplicamos (re-subir el mismo extracto no duplica), persistimos y corremos el matcher.

Matcher greedy (un comprobante ↔ un movimiento), por prioridad y dentro de una ventana de fechas
(el pago suele caer en/después de la factura):
  - alta:     monto exacto  Y  CUIT originante == CUIT del comprobante.
  - media:    monto exacto, sin CUIT (o CUIT distinto).
  - sugerido: monto dentro de tolerancia. Fuente-aware: banco ±0,5%; MercadoPago admite que el
              neto acreditado sea MENOR que la factura hasta ~7% (la comisión de MP se descuenta).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..schemas import TIPO_COMPROBANTE

# Notas de crédito: NO son cobrables, así que nunca son candidatas a matchear un ingreso. Se derivan
# del mapa oficial para no desincronizarse si se agregan tipos nuevos.
TIPOS_NOTA_CREDITO: set[int] = {t for t, n in TIPO_COMPROBANTE.items() if "Nota Crédito" in n}

# Parámetros del cruce (ajustables).
GRACIA = dt.timedelta(days=5)    # el pago puede adelantarse algunos días a la factura
VENTANA = dt.timedelta(days=60)  # ...o caer hasta 60 días después
TOL_EXACTO = 1.0                 # $1: tolera redondeos para considerar "monto exacto"
TOL_BANCO = 0.005                # ±0,5% para sugeridos de banco
TOL_MP = 0.07                    # MP: el neto puede ser hasta 7% MENOR que el bruto facturado

FUENTES = ("banco", "mercadopago", "otro")


def _digitos(s: str | None) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


def _comp_id(c: models.ComprobanteEmitido) -> str:
    """Id COMPUESTO del comprobante, idéntico al que arma routers/clientes.py, para que el front
    cruce el movimiento con su comprobante sin lookups extra."""
    return f"{c.cuit}-{c.direccion}-{c.punto_venta}-{c.cbte_tipo}-{c.numero}"


def _a_float(x: object) -> float | None:
    try:
        return float(x)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _a_fecha(s: str | None) -> dt.date | None:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s[:10])  # el front manda ISO aaaa-mm-dd
    except ValueError:
        return None


def _hash(cuit: str, fecha: dt.date, monto: float, desc: str | None, cuit_orig: str | None) -> str:
    crudo = f"{cuit}|{fecha.isoformat()}|{monto:.2f}|{desc or ''}|{cuit_orig or ''}"
    return hashlib.sha1(crudo.encode("utf-8")).hexdigest()  # noqa: S324 — dedup, no es seguridad


def _evaluar(
    mov: models.MovimientoBancario, comp: models.ComprobanteEmitido, fuente: str
) -> tuple[int, str] | None:
    """Devuelve (rank, confianza) si el comprobante es candidato del movimiento, o None. Rank menor
    = mejor (0 alta, 1 media, 2 sugerido)."""
    if not (comp.fecha - GRACIA <= mov.fecha <= comp.fecha + VENTANA):
        return None
    monto = float(mov.monto)
    total = float(comp.imp_total)
    if total <= 0:
        return None
    diff = abs(monto - total)
    exacto = diff <= TOL_EXACTO
    doc = _digitos(comp.doc_nro)
    cuit_ok = bool(mov.cuit_originante) and bool(doc) and mov.cuit_originante == doc
    if exacto and cuit_ok:
        return (0, "alta")
    if exacto:
        return (1, "media")
    if fuente == "mercadopago":
        if total * (1 - TOL_MP) <= monto <= total + TOL_EXACTO:
            return (2, "sugerido")
    elif diff <= total * TOL_BANCO:
        return (2, "sugerido")
    return None


def _matchear(db: Session, cuit: str, movimientos: list[models.MovimientoBancario], fuente: str) -> int:
    """Asigna a cada movimiento sin match su mejor comprobante libre (greedy). Muta los objetos en
    memoria (comprobante_matcheado_id + match_confianza). Devuelve cuántos matcheó."""
    sin_match = [m for m in movimientos if m.comprobante_matcheado_id is None]
    if not sin_match:
        return 0

    comps = db.scalars(
        select(models.ComprobanteEmitido).where(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.direccion == "emitido",
            models.ComprobanteEmitido.cbte_tipo.not_in(TIPOS_NOTA_CREDITO),
        )
    ).all()
    # Comprobantes ya tomados por OTROS movimientos (de importaciones previas): no se reusan.
    usados: set[str] = set(
        db.scalars(
            select(models.MovimientoBancario.comprobante_matcheado_id).where(
                models.MovimientoBancario.cuit == cuit,
                models.MovimientoBancario.comprobante_matcheado_id.is_not(None),
            )
        ).all()
    )
    disponibles = [(_comp_id(c), c) for c in comps if _comp_id(c) not in usados]

    n = 0
    for mov in sorted(sin_match, key=lambda m: m.fecha):
        mejor: tuple[int, float, int, str, str] | None = None
        for comp_id, comp in disponibles:
            ev = _evaluar(mov, comp, fuente)
            if ev is None:
                continue
            rank, confianza = ev
            adiff = abs(float(mov.monto) - float(comp.imp_total))
            adias = abs((mov.fecha - comp.fecha).days)
            cand = (rank, adiff, adias, comp_id, confianza)
            if mejor is None or cand[:3] < mejor[:3]:
                mejor = cand
        if mejor is not None:
            _, _, _, comp_id, confianza = mejor
            mov.comprobante_matcheado_id = comp_id
            mov.match_confianza = confianza
            disponibles = [(cid, c) for cid, c in disponibles if cid != comp_id]
            n += 1
    return n


def importar(db: Session, cuit: str, fuente: str, filas: list) -> dict:
    """Persiste las acreditaciones nuevas de un extracto y las cruza con los comprobantes emitidos.
    `filas` son objetos MovimientoIn (fecha ISO, monto, cuitOriginante?, nombreOriginante?, descripcion?).
    Idempotente: las filas ya importadas (mismo hash) se omiten."""
    fuente = fuente if fuente in FUENTES else "banco"
    lote = uuid.uuid4().hex[:16]
    importados = duplicados = descartados = 0
    nuevos: list[models.MovimientoBancario] = []

    for f in filas:
        monto = _a_float(getattr(f, "monto", None))
        fecha = _a_fecha(getattr(f, "fecha", None))
        if monto is None or monto <= 0 or fecha is None:
            descartados += 1  # débitos (gastos), filas en blanco o sin fecha válida
            continue
        desc = (getattr(f, "descripcion", None) or "").strip() or None
        cuit_orig = _digitos(getattr(f, "cuitOriginante", None)) or None
        nombre_orig = (getattr(f, "nombreOriginante", None) or "").strip() or None
        h = _hash(cuit, fecha, monto, desc, cuit_orig)
        ya_existe = db.scalar(
            select(models.MovimientoBancario.id).where(
                models.MovimientoBancario.cuit == cuit,
                models.MovimientoBancario.hash_dedup == h,
            )
        )
        if ya_existe:
            duplicados += 1
            continue
        mov = models.MovimientoBancario(
            cuit=cuit,
            fecha=fecha,
            monto=monto,
            fuente=fuente,
            cuit_originante=cuit_orig,
            nombre_originante=nombre_orig,
            descripcion=desc,
            lote_id=lote,
            hash_dedup=h,
        )
        db.add(mov)
        nuevos.append(mov)
        importados += 1

    db.flush()  # asigna ids a los nuevos antes de matchear
    matcheados = _matchear(db, cuit, nuevos, fuente)
    db.commit()
    pendientes = sum(1 for m in nuevos if m.comprobante_matcheado_id is None)
    return {
        "lote": lote,
        "importados": importados,
        "duplicados_omitidos": duplicados,
        "debitos_omitidos": descartados,
        "matcheados_auto": matcheados,
        "pendientes": pendientes,
        "movimientos": nuevos,
    }


def listar(db: Session, cuit: str) -> list[models.MovimientoBancario]:
    """Todos los movimientos del cliente, más reciente primero."""
    return list(
        db.scalars(
            select(models.MovimientoBancario)
            .where(models.MovimientoBancario.cuit == cuit)
            .order_by(models.MovimientoBancario.fecha.desc(), models.MovimientoBancario.id.desc())
        ).all()
    )


def reconciliar_pendientes(db: Session, cuit: str) -> int:
    """Re-corre el matcher sobre los movimientos sin match y sin clasificar. Útil cuando se
    sincronizan comprobantes DESPUÉS de haber subido el extracto. Devuelve cuántos resolvió."""
    pendientes = list(
        db.scalars(
            select(models.MovimientoBancario)
            .where(
                models.MovimientoBancario.cuit == cuit,
                models.MovimientoBancario.comprobante_matcheado_id.is_(None),
                models.MovimientoBancario.marcado_como.is_(None),
            )
            .order_by(models.MovimientoBancario.fecha)
        ).all()
    )
    if not pendientes:
        return 0
    # Agrupamos por fuente para respetar la tolerancia fuente-aware del matcher.
    n = 0
    for fuente in FUENTES:
        grupo = [m for m in pendientes if m.fuente == fuente]
        if grupo:
            n += _matchear(db, cuit, grupo, fuente)
    db.commit()
    return n


def clasificar(
    db: Session,
    cuit: str,
    mov_id: int,
    marcado_como: str | None = None,
    comprobante_id: str | None = None,
    contador_nombre: str | None = None,
) -> models.MovimientoBancario:
    """Override manual del contador. Tres modos:
      - comprobante_id != None  → fuerza un match contra ese comprobante (confianza 'manual').
      - marcado_como != None    → marca el movimiento como venta/no-venta (y suelta cualquier match).
      - ambos None              → resetea el movimiento (sin match, sin marca)."""
    mov = db.get(models.MovimientoBancario, mov_id)
    if mov is None or mov.cuit != cuit:
        raise ValueError(f"Movimiento {mov_id} no encontrado")
    ahora = dt.datetime.now(dt.timezone.utc)
    if comprobante_id is not None:
        mov.comprobante_matcheado_id = comprobante_id
        mov.match_confianza = "manual"
        mov.marcado_como = None
        mov.marcado_por = contador_nombre
        mov.marcado_en = ahora
    elif marcado_como is not None:
        mov.comprobante_matcheado_id = None
        mov.match_confianza = None
        mov.marcado_como = marcado_como
        mov.marcado_por = contador_nombre
        mov.marcado_en = ahora
    else:
        mov.comprobante_matcheado_id = None
        mov.match_confianza = None
        mov.marcado_como = None
        mov.marcado_por = None
        mov.marcado_en = None
    db.commit()
    return mov
