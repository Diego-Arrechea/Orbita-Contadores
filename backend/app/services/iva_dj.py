"""Declaración jurada de IVA ya presentada de un período.

Trae los importes tal como se declararon: son la fuente autoritativa de los conceptos que Órbita NO
puede derivar de los comprobantes (percepciones y retenciones sufridas, saldo a favor del período
anterior), que hasta ahora el contador cargaba a mano en los ajustes de la posición. También sirve
para contrastar el débito/crédito que calcula Órbita contra lo efectivamente declarado.

Es una consulta de SOLO LECTURA. Ver la memoria `lid-portal-integracion`.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar
from . import lid_import


def _clave_cliente(db: Session, cuit: str) -> tuple[models.ClienteARCA, str]:
    """(cliente, clave descifrada). ValueError si falta el cliente o su credencial."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial guardada")
    return cliente, descifrar(credencial.clave_cifrada).decode()


def importar_percepciones_auto(db: Session, cuit: str, periodo: str) -> dict:
    """Trae de AFIP el detalle por comprobante del período (`periodo` = 'aaaa-mm', tiene que estar
    SIN presentar) y lo importa sobre los comprobantes cacheados — exactamente lo mismo que si el
    contador hubiera descargado el archivo del Portal IVA y lo hubiera subido, pero sin ese paso.

    El ciclo crea y descarta un borrador en el Libro IVA del cliente (huella transitoria); si el
    período ya está presentado o hay un borrador ajeno abierto, el motor corta con LivaOcupadoError
    ANTES de tocar nada. Devuelve {actualizados, sin_match, total} acumulado de ventas + compras.
    """
    cliente, clave = _clave_cliente(db, cuit)
    archivos = motor.liva_percepciones(
        cliente.cuit_credencial, clave, periodo=periodo.replace("-", "")
    )
    resumen = {"actualizados": 0, "sin_match": 0, "total": 0}
    for lado in ("ventas", "compras"):
        contenido = archivos.get(lado)
        if not contenido:
            continue
        parcial = lid_import.importar(db, cuit, contenido)
        for k in resumen:
            resumen[k] += int(parcial.get(k) or 0)
    return resumen


def traer_dj_presentada(db: Session, cuit: str, periodo: str) -> dict | None:
    """DDJJ de IVA presentada del período (`periodo` = 'aaaa-mm'). None si ese período no tiene
    declaración presentada. Los importes vuelven en el formato del motor (claves snake_case)."""
    cliente, clave = _clave_cliente(db, cuit)
    # El portal habla 'AAAAMM'; la app, 'aaaa-mm'.
    datos = motor.dj_iva(cliente.cuit_credencial, clave, periodo=periodo.replace("-", ""))
    if not datos:
        return None
    # Devolvemos el período en el formato de la app, no el del portal.
    crudo = str(datos.get("periodo") or "")
    if len(crudo) == 6 and crudo.isdigit():
        datos["periodo"] = f"{crudo[:4]}-{crudo[4:]}"
    return datos
