"""
Comunicaciones del Domicilio Fiscal Electrónico (DFE / e-ventanilla).

Trae las comunicaciones del cliente desde ARCA (motor.comunicaciones), las cachea en la DB y
resuelve la marca de "leído":
  - `sincronizar_comunicaciones`: upsert incremental por (cuit, id_comunicacion). En el PRIMER sync
    del cliente (dfe_baseline_en NULL) las comunicaciones vigentes nacen `vista_por_contador=True`
    (baseline anti-spam): sólo las que aparezcan en pasadas siguientes cuentan como novedad.
  - `marcar_vista`: el contador abrió la comunicación en Órbita → pedimos el detalle a ARCA (eso hace
    que ARCA la marque leída) y la marcamos vista localmente (apaga el punto rojo).
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar


def _clave_cliente(db: Session, cuit: str) -> tuple[models.ClienteARCA, str]:
    """Devuelve (cliente, clave_descifrada) o levanta ValueError si falta el cliente/credencial."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    contador = db.get(models.Contador, cliente.cuit_contador)
    if contador is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial guardada")
    return cliente, descifrar(contador.clave_cifrada).decode()


def _dt(v) -> dt.datetime | None:
    """El motor ya normaliza las fechas a datetime; toleramos None/str por las dudas."""
    return v if isinstance(v, dt.datetime) else None


def sincronizar_comunicaciones(db: Session, cuit: str) -> int:
    """Trae las comunicaciones del DFE del cliente y las upsertea. Devuelve cuántas NUEVAS se
    guardaron en esta corrida (las que no existían). Baseline en el primer sync: nacen ya vistas."""
    cliente, clave = _clave_cliente(db, cuit)
    # Nos logueamos con la credencial guardada (cuit_contador) y consultamos el CUIT del cliente:
    # si el cliente representa a otro, cuit_contador ≠ cuit → ARCA autoriza por delegación. Para un
    # titular normal ambos coinciden. Ver notificaciones_listar(cuit=...).
    lista = motor.comunicaciones(cliente.cuit_contador, clave, cuit_objetivo=cliente.cuit)

    primer_sync = cliente.dfe_baseline_en is None
    existentes = set(
        db.scalars(
            select(models.ComunicacionDFE.id_comunicacion).where(
                models.ComunicacionDFE.cuit == cuit
            )
        )
    )
    ahora = dt.datetime.now(dt.timezone.utc)
    nuevas = 0
    for c in lista:
        idc = str(c.get("id") or "").strip()
        if not idc:
            continue
        if idc in existentes:
            continue  # ya la teníamos (el estado leído lo maneja marcar_vista / el próximo detalle)
        prioridad = c.get("prioridad")
        db.add(
            models.ComunicacionDFE(
                cuit=cuit,
                id_comunicacion=idc,
                fecha_publicacion=_dt(c.get("fecha_publicacion")),
                fecha_vencimiento=_dt(c.get("fecha_vencimiento")),
                sistema=(c.get("sistema") or None),
                organismo=(c.get("organismo") or None),
                asunto=((c.get("mensaje") or "") or None) and (c.get("mensaje") or "")[:500],
                prioridad=(str(prioridad) if prioridad is not None else None),
                tiene_adjunto=bool(c.get("tiene_adjunto")),
                leida_arca=bool(c.get("leida")),
                # Baseline: en el primer sync todo nace "ya visto" (sin punto rojo ni novedad); las
                # comunicaciones que lleguen después nacen sin ver y sí aparecen como novedad.
                vista_por_contador=primer_sync,
                sincronizado_en=ahora,
            )
        )
        existentes.add(idc)
        nuevas += 1

    if primer_sync:
        cliente.dfe_baseline_en = ahora
    db.commit()
    return nuevas


def listar(db: Session, cuit: str) -> list[models.ComunicacionDFE]:
    """Comunicaciones cacheadas del cliente (más reciente primero)."""
    return list(
        db.scalars(
            select(models.ComunicacionDFE)
            .where(models.ComunicacionDFE.cuit == cuit)
            .order_by(
                models.ComunicacionDFE.fecha_publicacion.desc().nullslast(),
                models.ComunicacionDFE.id.desc(),
            )
        )
    )


def sin_ver(db: Session, cuit: str) -> int:
    """Cuántas comunicaciones tiene el cliente sin abrir por el contador (para el punto rojo)."""
    return len(
        db.scalars(
            select(models.ComunicacionDFE.id).where(
                models.ComunicacionDFE.cuit == cuit,
                models.ComunicacionDFE.vista_por_contador.is_(False),
            )
        ).all()
    )


def marcar_vista(db: Session, cuit: str, id_comunicacion: str) -> models.ComunicacionDFE | None:
    """El contador abrió la comunicación en Órbita: baja el detalle completo (ARCA la marca leída al
    pedirlo) y la marca vista localmente. El detalle es best-effort: aunque falle la baja en vivo, la
    marcamos vista para que el punto rojo refleje que el contador ya la miró. Devuelve la fila o None."""
    com = db.scalar(
        select(models.ComunicacionDFE).where(
            models.ComunicacionDFE.cuit == cuit,
            models.ComunicacionDFE.id_comunicacion == str(id_comunicacion),
        )
    )
    if com is None:
        return None
    if com.detalle is None or not com.leida_arca:
        try:
            cliente, clave = _clave_cliente(db, cuit)
            det = motor.comunicacion_detalle(
                cliente.cuit_contador, clave, id_comunicacion, cuit_objetivo=cliente.cuit
            )
            if det.get("mensaje"):
                com.detalle = det["mensaje"]
            com.leida_arca = True  # pedir el detalle la marca leída en ARCA
        except Exception:  # noqa: BLE001 — la baja en vivo es best-effort; igual marcamos vista local
            pass
    com.vista_por_contador = True
    db.commit()
    db.refresh(com)
    return com
