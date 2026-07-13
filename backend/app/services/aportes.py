"""Aportes en Línea (MisAportes): remuneración del cliente en relación de dependencia.

El servicio es PERSONAL (sólo el titular de la clave), así que se consulta cuando el cliente es
titular de su propia credencial. Trae el F.931 que informa el empleador: sirve para justificar
gastos (el haber percibido respalda compras a "consumidor final") y es la señal AUTORITATIVA de
relación de dependencia. Consulta de BAJA CADENCIA (no en cada sync): suma requests y no queremos
despertar el anti-automatización de ARCA. Ver la memoria `aportes-en-linea-misaportes`.
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar

# Cadencias del gate: los que tienen relación de dependencia se refrescan seguido (la remuneración
# cambia mes a mes); los que no, se re-chequean de vez en cuando por si empiezan a trabajar en blanco.
_REFRESH_POSITIVO_DIAS = 7
_RECHECK_NEGATIVO_DIAS = 30


def _es_persona_fisica(cuit: str) -> bool:
    """El CUIT de una persona física arranca con 20/23/24/27 (las sociedades, con 30/33/34)."""
    return str(cuit)[:2] in ("20", "23", "24", "27")


def sincronizar_aportes(db: Session, cuit: str) -> dict:
    """Consulta "Aportes en Línea" del cliente (titular), persiste la remuneración y setea
    `relacion_dependencia` (auto). Devuelve el dict del motor. NO toca el override manual del
    contador (que vive en edicion_json y gana al mostrar)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    datos = motor.mis_aportes(credencial.cuit, clave)
    es_rd = datos.get("es_relacion_dependencia")  # True | False | None (no determinable)
    if es_rd is None:
        return datos  # pantalla inesperada/error: no afirmamos ni pisamos el estado guardado
    cliente.relacion_dependencia = bool(es_rd)
    if es_rd and datos.get("remuneraciones"):
        cliente.remuneraciones_json = json.dumps(
            {
                "empleadores": datos.get("empleadores", []),
                "remuneraciones": datos.get("remuneraciones", []),
                "total_bruto": datos.get("total_bruto", 0.0),
                "periodo_desde": datos.get("periodo_desde"),
                "periodo_hasta": datos.get("periodo_hasta"),
                "actualizado_en": dt.datetime.now(dt.timezone.utc).isoformat(),
            },
            ensure_ascii=False,
        )
    elif es_rd is False:
        cliente.remuneraciones_json = None  # sin relación de dependencia: sin remuneración guardada
    db.commit()
    return datos


def paso_worker(db: Session, cuit: str) -> dict | None:
    """Entrada del motor 24/7 para Aportes en Línea, gateado y de baja cadencia.

    - Sólo personas físicas TITULARES de su clave (el servicio es personal; no cubre representados).
    - Nunca chequeado (`aportes_chequeado_en` NULL) → consulta una vez y marca la fecha (sólo si
      salió bien; si falla queda NULL y reintenta en la próxima pasada → auto-sanador).
    - Con relación de dependencia → refresca semanal (la remuneración cambia mes a mes).
    - Sin relación de dependencia → re-chequea cada ~30 días (puede empezar a trabajar en blanco).
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        return None
    # Sólo titular persona física (mis_aportes es personal; representados/sociedades quedan afuera).
    if cliente.cuit_credencial != cuit or not _es_persona_fisica(cuit):
        return None
    ahora = dt.datetime.now(dt.timezone.utc)
    ultima = cliente.aportes_chequeado_en
    if ultima is not None:
        if ultima.tzinfo is None:  # SQLite naive → normalizamos a UTC
            ultima = ultima.replace(tzinfo=dt.timezone.utc)
        dias = _REFRESH_POSITIVO_DIAS if cliente.relacion_dependencia else _RECHECK_NEGATIVO_DIAS
        if ultima > ahora - dt.timedelta(days=dias):
            return None  # dentro de la ventana: no re-consultar
    # Si sincronizar_aportes levanta (bloqueo/ARCA), NO marcamos la fecha → reintenta.
    res = sincronizar_aportes(db, cuit)
    cliente.aportes_chequeado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return res
