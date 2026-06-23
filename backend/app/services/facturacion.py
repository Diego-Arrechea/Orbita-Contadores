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
from ..arca import wsfev1
from ..config import settings
from ..crypto import cifrar, descifrar
from ..scraping import bootstrap

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

    cert_pem, key_pem = bootstrap.bootstrap_cliente(
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


def emitir(
    db: Session,
    cuit: str,
    *,
    cbte_tipo: int,
    importe_total: float,
    punto_venta: int,
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
    return {
        "tiene_certificado": tiene,
        "homologacion": settings.arca_homo,  # el front avisa "modo prueba" cuando es True
        "cert_actualizado_en": (
            cliente.cert_actualizado_en.isoformat() if cliente.cert_actualizado_en else None
        ),
    }
