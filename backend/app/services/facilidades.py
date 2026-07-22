"""Planes de facilidades de pago ("Mis Facilidades") del cliente.

Servicio PERSONAL (sólo el titular de la clave). Trae el LISTADO de planes con su situación (vigente /
caduco / cancelado / refinanciado …) para el cuadro de la ficha y el aviso de "plan caduco". Consulta
de BAJA CADENCIA (los planes casi no cambian; suma requests y no queremos despertar el anti-automa-
tización de ARCA). La cantidad de cuotas impagas por plan NO está en el listado (queda para v2). Ver
la memoria `pedidos-contadores-jul2026` (#7).
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar

_RECHECK_DIAS = 14  # los planes cambian de estado con baja frecuencia


def _es_persona_fisica(cuit: str) -> bool:
    """El CUIT de una persona física arranca con 20/23/24/27 (las sociedades, con 30/33/34)."""
    return str(cuit)[:2] in ("20", "23", "24", "27")


def sincronizar_facilidades(db: Session, cuit: str) -> list[dict]:
    """Consulta Mis Facilidades del cliente (titular) y persiste los planes en `facilidades_json`
    (JSON serializado; '[]' = consultado y sin planes). Devuelve la lista de planes."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    planes = motor.facilidades(credencial.cuit, clave)  # levanta si falla el SSO/fetch
    cliente.facilidades_json = json.dumps(planes, ensure_ascii=False)
    db.commit()
    return planes


def paso_worker(db: Session, cuit: str) -> list[dict] | None:
    """Entrada del motor 24/7 para Mis Facilidades, gateada y de baja cadencia.

    - Sólo personas físicas TITULARES de su clave (el servicio es personal; no cubre representados).
    - Nunca chequeado (`facilidades_chequeado_en` NULL) → consulta una vez y marca la fecha (sólo si
      salió bien; si falla queda NULL y reintenta → auto-sanador).
    - Ya chequeado → re-consulta cada ~14 días (los planes cambian de estado con baja frecuencia).
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        return None
    if cliente.cuit_credencial != cuit or not _es_persona_fisica(cuit):
        return None
    ahora = dt.datetime.now(dt.timezone.utc)
    ultima = cliente.facilidades_chequeado_en
    if ultima is not None:
        if ultima.tzinfo is None:  # SQLite naive → normalizamos a UTC
            ultima = ultima.replace(tzinfo=dt.timezone.utc)
        if ultima > ahora - dt.timedelta(days=_RECHECK_DIAS):
            return None  # dentro de la ventana: no re-consultar
    # Si sincronizar_facilidades levanta (bloqueo/ARCA), NO marcamos la fecha → reintenta.
    res = sincronizar_facilidades(db, cuit)
    cliente.facilidades_chequeado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return res
