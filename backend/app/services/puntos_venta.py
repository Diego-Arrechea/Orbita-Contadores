"""Puntos de venta del contribuyente (ABM de puntos de venta).

Trae el listado de puntos de venta con su nombre de fantasía, sistema de emisión y domicilio, para
poder mostrar la facturación por punto de venta con NOMBRE y no sólo con el número ("00002 · Local
Centro" en vez de "00002").

Consulta de UNA SOLA VEZ por cliente: el dato es casi estático (un punto de venta se da de alta y
queda), y cada consulta suma requests. Si el intento falla, se reintenta pasados unos días.

Muchos contribuyentes no tienen cargado el nombre de fantasía (el listado lo devuelve vacío): para
esos casos el contador puede ponerle un nombre a mano, que vive en `edicion_json`
(clave `puntosVentaNombres`) y gana sobre el registrado. Ver routers/clientes.py::_puntos_venta.
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar

_REINTENTO_DIAS = 7  # si la consulta falló, no reintentar en cada pasada del motor

# Lo que persistimos de cada punto (el resto del dict crudo no aporta nada a la ficha).
_CAMPOS = ("nro", "sistema", "sistema_desc", "nombre_fantasia", "domicilio", "baja", "bloqueado")


def sincronizar_puntos_venta(db: Session, cuit: str) -> list[dict]:
    """Consulta los puntos de venta del cliente y los persiste en `puntos_venta_json`.

    Incluye los dados de baja: siguen apareciendo en la facturación histórica del cliente, así que
    también necesitan nombre. '[]' = consultado y sin puntos. Devuelve la lista guardada.
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    crudos = motor.puntos_venta_pvel(credencial.cuit, clave, incluir_baja=True)
    puntos = [{k: p.get(k) for k in _CAMPOS} for p in crudos if p.get("nro") is not None]
    cliente.puntos_venta_json = json.dumps(puntos, ensure_ascii=False)
    cliente.pv_chequeado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return puntos


def paso_worker(db: Session, cuit: str) -> list[dict] | None:
    """Entrada del motor 24/7: trae los puntos de venta UNA vez por cliente.

    - Sólo TITULARES de la clave: el ABM es del propio contribuyente (un representado no lo expone).
    - Ya traídos (hay lista guardada) → no se vuelve a consultar. Si un cliente da de alta un punto
      nuevo, el contador puede nombrarlo a mano sin esperar nada.
    - Si el intento falló, se reintenta recién pasados `_REINTENTO_DIAS` (no en cada pasada).

    Devuelve la lista traída, o None si no correspondía consultar.
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None or cliente.cuit_credencial != cuit:
        return None
    if cliente.puntos_venta_json:
        return None
    ultima = cliente.pv_chequeado_en
    if ultima is not None:
        if ultima.tzinfo is None:  # SQLite naive → normalizamos a UTC
            ultima = ultima.replace(tzinfo=dt.timezone.utc)
        if ultima > dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=_REINTENTO_DIAS):
            return None
    try:
        return sincronizar_puntos_venta(db, cuit)
    except Exception:
        # Dejamos marcado el intento para no golpear en cada pasada; el reintento va en unos días.
        db.rollback()
        cliente = db.get(models.ClienteARCA, cuit)
        if cliente is not None:
            cliente.pv_chequeado_en = dt.datetime.now(dt.timezone.utc)
            db.commit()
        raise
