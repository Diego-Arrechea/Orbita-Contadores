"""Sincronización de las Liquidaciones Electrónicas del sector primario (agro).

Aparte de 'Mis Comprobantes': estas liquidaciones (Hacienda y Carne, Lechería, Tabaco, Azúcar)
NO aparecen ahí — las emite el comprador/acopiador y el productor las recibe. Son la venta real
del cliente y se suman a su facturación. Se traen del servicio LSP (arca/afip.py::lsp_consultar +
lsp_pdf) y se cachea acá. Sync SEMANAL (aparecen rara vez). Ver la memoria `facturacion-agropecuaria`.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar


def _parse_fecha(f: str | None) -> dt.date | None:
    """'dd/mm/aaaa' -> date. None/'' -> None."""
    if not f or "/" not in f:
        return None
    try:
        d, m, y = f.split("/")
        return dt.date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def _upsert(db: Session, cuit: str, crudos: list[dict]) -> tuple[int, int, int]:
    """Inserta/actualiza las liquidaciones (dedup por liq_id). Devuelve
    (procesadas, nuevas, sin_importe)."""
    ahora = dt.datetime.now(dt.timezone.utc)
    procesadas = nuevas = sin_importe = 0
    for c in crudos:
        liq_id = str(c.get("liq_id") or "")
        if not liq_id:
            continue
        bruto = c.get("importe_bruto")
        if bruto is None:
            sin_importe += 1
        existe = db.scalar(
            select(models.LiquidacionAgro).where(
                models.LiquidacionAgro.cuit == cuit,
                models.LiquidacionAgro.liq_id == liq_id,
            )
        )
        campos = dict(
            sector=c.get("sector", "hacienda"),
            direccion=c.get("direccion", "receptor"),
            cbte_tipo=int(c.get("cbte_tipo") or 0),
            tipo_liq=(c.get("tipo_liq") or "")[:80],
            punto_venta=int(c.get("punto_venta") or 0),
            numero=int(c.get("numero") or 0),
            cuit_contraparte=str(c.get("cuit_contraparte") or ""),
            fecha_comprobante=_parse_fecha(c.get("fecha_comprobante")),
            fecha_emision=_parse_fecha(c.get("fecha_emision")),
            sistema=(c.get("sistema") or "")[:4],
            importe_bruto=bruto if bruto is not None else 0,
            sincronizado_en=ahora,
        )
        if existe:
            for k, v in campos.items():
                setattr(existe, k, v)
        else:
            db.add(models.LiquidacionAgro(cuit=cuit, liq_id=liq_id, **campos))
            nuevas += 1
        procesadas += 1
    return procesadas, nuevas, sin_importe


def sincronizar_agro(
    db: Session,
    cuit: str,
    *,
    sector: str = "hacienda",
    marcar_flag: bool = True,
    on_progress=None,
) -> dict:
    """Trae y cachea las liquidaciones del agro del cliente. Devuelve
    {tiene, procesadas, nuevas, sin_importe, total_bruto}.

    `marcar_flag`: si hay liquidaciones, prende `cliente.factura_agro` (útil en la barrida inicial
    de detección; NUNCA lo apaga: un flag puesto a mano por el contador se respeta)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    crudos = motor.liquidaciones_agro(
        credencial.cuit, clave, cuit, sector=sector, on_progress=on_progress
    )
    procesadas, nuevas, sin_importe = _upsert(db, cuit, crudos)
    tiene = procesadas > 0
    if tiene and marcar_flag and not cliente.factura_agro:
        cliente.factura_agro = True
    db.commit()

    total_bruto = float(
        db.scalar(
            select(func.coalesce(func.sum(models.LiquidacionAgro.importe_bruto), 0)).where(
                models.LiquidacionAgro.cuit == cuit
            )
        )
        or 0
    )
    return {
        "tiene": tiene,
        "procesadas": procesadas,
        "nuevas": nuevas,
        "sin_importe": sin_importe,
        "total_bruto": total_bruto,
    }


def sincronizar_agro_si_corresponde(
    db: Session, cuit: str, *, sector: str = "hacienda", dias: int = 7
) -> dict | None:
    """Corre la sync del agro SÓLO si el cliente está marcado (`factura_agro`) y no se sincronizó en
    los últimos `dias`. Pensado para el motor 24/7: visita cada cliente cada ~12h, pero estas
    liquidaciones aparecen rara vez, así que alcanza con una pasada SEMANAL. Devuelve el resultado
    de `sincronizar_agro`, o None si no correspondía (no marcado o ya sincronizado hace poco)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None or not cliente.factura_agro:
        return None
    ultima = db.scalar(
        select(func.max(models.LiquidacionAgro.sincronizado_en)).where(
            models.LiquidacionAgro.cuit == cuit
        )
    )
    if ultima is not None:
        if ultima.tzinfo is None:  # Postgres devuelve aware; SQLite naive → normalizamos a UTC
            ultima = ultima.replace(tzinfo=dt.timezone.utc)
        if ultima > dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=dias):
            return None  # todavía dentro de la ventana semanal
    # Ya está marcado: no re-evaluamos el flag (marcar_flag=False).
    return sincronizar_agro(db, cuit, sector=sector, marcar_flag=False)
