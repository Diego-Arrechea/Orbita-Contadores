"""
Facturación electrónica del cliente (WSFEv1): provisión del certificado on-demand + emisión.

Modelo (ver memoria `credenciales-arca`): cada cliente tiene su propia clave fiscal guardada (la
cargó el contador). Con esa clave generamos un certificado POR CLIENTE (auto-emitido: el cliente es
el titular), sin delegación ni certificado de contador. Con ese cert emitimos sus comprobantes.
"""
from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from pathlib import Path

from sqlalchemy.orm import Session

from .. import models
from ..arca import motor, wsfev1
from ..config import settings
from ..crypto import cifrar, descifrar

ProgressCb = Callable[[int, str], None]


def _homo_configurado() -> bool:
    return bool(
        settings.arca_homo_cert_path and settings.arca_homo_key_path and settings.arca_homo_cuit
    )


def _cert_y_emisor(
    db: Session, cuit: str, on_progress: ProgressCb | None
) -> tuple[bytes, bytes, str]:
    """Devuelve (cert, key, cuit_emisor) según el entorno.

    HOMOLOGACIÓN (settings.arca_homo): usa el certificado de prueba configurado y su CUIT — NO
    bootstrapea el del cliente (en homologación el cert real del cliente no sirve). Pensado para
    probar el flujo completo en desarrollo sin emitir facturas reales.
    PRODUCCIÓN: usa el certificado del propio cliente, generándolo on-demand la primera vez."""
    if settings.arca_homo:
        if not _homo_configurado():
            raise ValueError(
                "Homologación activa pero falta el certificado de prueba "
                "(ARCA_HOMO_CERT_PATH / ARCA_HOMO_KEY_PATH / ARCA_HOMO_CUIT en .env)."
            )
        cert = Path(settings.arca_homo_cert_path).read_bytes()
        key = Path(settings.arca_homo_key_path).read_bytes()
        return cert, key, settings.arca_homo_cuit
    cert, key = asegurar_certificado(db, cuit, on_progress=on_progress)
    return cert, key, cuit


class SinPuntoVenta(RuntimeError):
    """El cliente no tiene ningún punto de venta habilitado para facturación electrónica (Web Service).
    Hay que darlo de alta en AFIP (ABM Puntos de Venta, sistema 'Web Service')."""


def _cert_existente(db: Session, cuit: str) -> tuple[bytes, bytes, str] | None:
    """(cert, key, cuit_emisor) si YA hay certificado disponible, SIN bootstrapear. None si no hay."""
    cliente = db.get(models.ClienteARCA, cuit)
    if settings.arca_homo:
        if not _homo_configurado():
            return None
        return (
            Path(settings.arca_homo_cert_path).read_bytes(),
            Path(settings.arca_homo_key_path).read_bytes(),
            settings.arca_homo_cuit,
        )
    if cliente and cliente.cert_cifrado and cliente.key_cifrado:
        return descifrar(cliente.cert_cifrado), descifrar(cliente.key_cifrado), cuit
    return None


def puntos_venta(db: Session, cuit: str) -> list[dict] | None:
    """Puntos de venta Web Service del cliente. None si todavía no hay certificado para consultarlos."""
    cred = _cert_existente(db, cuit)
    if cred is None:
        return None
    cert, key, emisor = cred
    pvs = wsfev1.listar_puntos_venta(emisor, cert, key)
    if not pvs and settings.arca_homo:
        # En homologación FEParamGetPtosVenta suele venir vacío, pero el PV de prueba sí emite.
        return [{"nro": settings.arca_homo_punto_venta, "emision_tipo": "homologación"}]
    return pvs


def asegurar_certificado(
    db: Session, cuit: str, on_progress: ProgressCb | None = None
) -> tuple[bytes, bytes]:
    """Devuelve (cert_pem, key_pem) del cliente, generándolo si todavía no lo tiene.

    La generación es scraping (~30-60s): corre `bootstrap_cliente` con la clave del propio cliente,
    que crea el certificado y lo asocia al WS Facturación Electrónica, y lo guarda cifrado. Idempotente.
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    if cliente.cert_cifrado and cliente.key_cifrado:
        return descifrar(cliente.cert_cifrado), descifrar(cliente.key_cifrado)

    contador = db.get(models.Contador, cliente.cuit_contador)
    if contador is None:
        raise ValueError(f"El cliente {cuit} no tiene credencial de acceso guardada")
    clave = descifrar(contador.clave_cifrada).decode()

    cert_pem, key_pem = motor.bootstrap_cliente(
        cuit_cliente=cuit,
        cuit_login=cliente.cuit_contador,
        clave=clave,
        on_progress=on_progress,
    )
    cliente.cert_cifrado = cifrar(cert_pem)
    cliente.key_cifrado = cifrar(key_pem)
    cliente.cert_actualizado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return cert_pem, key_pem


# Sistemas de PV habilitados para facturar por Web Service (WSFEv1) en monotributo.
# MAW = Factura Electrónica Monotributo Web Services (el que crea pventa_crear).
_PV_SIS_WS = {"MAW"}


def asegurar_punto_venta(db: Session, cuit: str, on_progress: ProgressCb | None = None) -> dict | None:
    """Asegura que el cliente tenga un PV de Web Service para facturar; si no tiene, le
    crea uno (sistema MAW). Es el último paso del onboarding de facturación que antes era
    MANUAL. Idempotente: no duplica si ya hay uno.

    Sólo por HTTP: el ABM de Puntos de Venta vive en afip.py (pvel). En homologación o con
    el motor browser no se auto-crea (queda el alta manual en AFIP, como antes).
    """
    if settings.arca_homo or settings.motor_scraping != "http":
        return None
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    # 1) ¿Ya tiene un PV de WS? (autoritativo: el WS oficial; requiere el cert ya generado).
    try:
        ws = puntos_venta(db, cuit)
    except Exception:  # noqa: BLE001 — si el WS falla, seguimos al chequeo por ABM
        ws = None
    if ws:
        return ws[0]
    contador = db.get(models.Contador, cliente.cuit_contador)
    if contador is None:
        raise ValueError(f"El cliente {cuit} no tiene credencial de acceso guardada")
    clave = descifrar(contador.clave_cifrada).decode()
    # 2) No figura en el WS. ¿Hay un MAW en el ABM (que no se propagó al WS aún)? No duplicar.
    pvs = motor.puntos_venta_pvel(contador.cuit, clave)
    existente = next(
        (p for p in pvs if p.get("sistema") in _PV_SIS_WS and not p.get("baja") and not p.get("bloqueado")),
        None,
    )
    if existente:
        return existente
    # 3) Crear el PV (MAW) y devolver el recién creado.
    if on_progress:
        on_progress(85, "Creando el punto de venta…")
    motor.crear_punto_venta(contador.cuit, clave, nombre="Órbita", sistema="MAW")
    pvs = motor.puntos_venta_pvel(contador.cuit, clave)
    return next(
        (p for p in pvs if p.get("sistema") in _PV_SIS_WS and not p.get("baja")), None
    )


def emitir(
    db: Session,
    cuit: str,
    *,
    cbte_tipo: int,
    importe_total: float,
    punto_venta: int | None = None,  # None = auto-detectar el PV Web Service del cliente
    concepto: int = 1,
    doc_tipo: int = 99,
    doc_nro: str = "0",
    condicion_iva_receptor: int = 5,
    comprobante_asociado: dict | None = None,
    on_progress: ProgressCb | None = None,
) -> dict:
    """Emite una Factura C (11) o Nota de Crédito C (13) a nombre del cliente y persiste el
    comprobante (aparece en la lista de comprobantes y en Facturación 12m). Devuelve el CAE."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")

    cert_bytes, key_bytes, cuit_emisor = _cert_y_emisor(db, cuit, on_progress)

    # Auto-detectar el punto de venta Web Service si no se forzó uno.
    if not punto_venta:
        pvs = wsfev1.listar_puntos_venta(cuit_emisor, cert_bytes, key_bytes)
        if not pvs and not settings.arca_homo:
            # No tiene PV de WS: lo creamos (MAW) automáticamente y re-detectamos. Si aún
            # no aparece (propagación), cae en SinPuntoVenta y el front muestra el tutorial.
            asegurar_punto_venta(db, cuit)
            pvs = wsfev1.listar_puntos_venta(cuit_emisor, cert_bytes, key_bytes)
        if pvs:
            punto_venta = pvs[0]["nro"]
        elif settings.arca_homo:
            # Homologación: FEParamGetPtosVenta viene vacío, pero el PV de prueba sí emite.
            punto_venta = settings.arca_homo_punto_venta
        else:
            raise SinPuntoVenta()

    resultado = wsfev1.emitir_comprobante_c(
        cuit_emisor,
        cert_bytes,
        key_bytes,
        cbte_tipo=cbte_tipo,
        punto_venta=punto_venta,
        importe_total=importe_total,
        concepto=concepto,
        doc_tipo=doc_tipo,
        doc_nro=doc_nro,
        condicion_iva_receptor=condicion_iva_receptor,
        comprobante_asociado=comprobante_asociado,
    )

    # Persistimos el comprobante recién emitido para que aparezca igual que los sincronizados.
    fecha = dt.date.fromisoformat(resultado["fecha"])
    db.add(
        models.ComprobanteEmitido(
            cuit=cuit,
            direccion="emitido",
            cbte_tipo=resultado["cbte_tipo"],
            punto_venta=resultado["punto_venta"],
            numero=resultado["numero"],
            fecha=fecha,
            imp_total=resultado["importe_total"],
            moneda="ARS",
            cotizacion=1,
            imp_total_origen=resultado["importe_total"],
            doc_nro=str(doc_nro or ""),
            cae=resultado["cae"],
        )
    )
    db.commit()
    return resultado


def contexto(db: Session, cuit: str) -> dict:
    """Estado de facturación del cliente: si ya tiene certificado (y por ende puede facturar sin la
    espera del bootstrap) y desde cuándo. No llama a ARCA."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    # En homologación el cert es el de prueba configurado (no se bootstrapea el del cliente).
    tiene = _homo_configurado() if settings.arca_homo else bool(cliente.cert_cifrado and cliente.key_cifrado)
    # Si ya hay cert, consultamos los puntos de venta Web Service (para auto-seleccionar / avisar si
    # falta). best-effort: si ARCA falla, devolvemos None y el front no rompe.
    pvs: list[dict] | None = None
    if tiene:
        try:
            pvs = puntos_venta(db, cuit)
        except Exception:  # noqa: BLE001
            pvs = None
    return {
        "tiene_certificado": tiene,
        "homologacion": settings.arca_homo,  # el front avisa "modo prueba" cuando es True
        "puntos_venta": pvs,  # [{nro, emision_tipo}] | None (None = no se pudo consultar todavía)
        "cert_actualizado_en": (
            cliente.cert_actualizado_en.isoformat() if cliente.cert_actualizado_en else None
        ),
    }
