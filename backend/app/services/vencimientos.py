"""Recordatorio mensual de vencimientos al cliente final (por mail).

Fase 1: arma el mail del próximo vencimiento de monotributo con los datos que ya trae la sync
(`prox_venc_fecha` / `prox_venc_importe`). Regla de producto: la copy va en términos del dominio
impositivo, sin mencionar de dónde sale el dato. Marca Órbita (el white-label del estudio es un
extra pago futuro, por eso el remitente/branding se mantiene parametrizable).

Degradación (decisión de producto): si el importe no está fresco —la última sincronización exitosa
del cliente quedó vieja— el mail sale SÓLO con la fecha, nunca con un monto potencialmente
equivocado. Si el cliente no tiene un próximo vencimiento cargado, no hay nada para recordar (None).
"""
from __future__ import annotations

import datetime as dt
import json
import logging

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from . import email as email_svc

logger = logging.getLogger("orbita.vencimientos")

_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def nombre_mes(mes: int) -> str:
    """Nombre en español del mes (1-12), para títulos y asuntos."""
    return _MESES[mes - 1]


def _pesos(monto) -> str:
    """Formatea un importe en pesos al formato argentino: 12345.6 -> '$12.345,60'."""
    entero = f"{float(monto):,.2f}"  # formato US: '12,345.60'
    # swap de separadores (US -> AR) usando un marcador intermedio para no pisar lo ya cambiado
    return "$" + entero.replace(",", "@").replace(".", ",").replace("@", ".")


def importe_fresco(db: Session, cuit: str, hoy: dt.date, umbral_dias: int | None = None) -> bool:
    """¿El importe del próximo vencimiento es confiable? Lo es si el cliente se sincronizó con éxito
    hace poco (dentro de `venc_frescura_dias`). Sin sync exitosa reciente, el importe puede ser el de
    un período pasado: se considera NO fresco y el mail degrada a solo-fecha."""
    umbral = settings.venc_frescura_dias if umbral_dias is None else umbral_dias
    ult = db.scalar(
        select(models.Extraccion.fecha)
        .where(models.Extraccion.cuit == cuit, models.Extraccion.resultado == "exitosa")
        .order_by(models.Extraccion.fecha.desc())
        .limit(1)
    )
    if ult is None:
        return False
    return (hoy - ult.date()).days <= umbral


def armar_mail(
    cliente: models.ClienteARCA, hoy: dt.date, fresco: bool
) -> tuple[str, str, str] | None:
    """Arma (asunto, html, texto) del recordatorio para un cliente. Devuelve None si el cliente no
    tiene un próximo vencimiento cargado (nada para recordar). `fresco` decide si se incluye el
    importe: si es False (o no hay importe), el mail sale sólo con la fecha."""
    fecha = cliente.prox_venc_fecha
    if not fecha:
        return None
    importe = cliente.prox_venc_importe
    sufijo = f" por {_pesos(importe)}" if (fresco and importe is not None) else ""
    saludo = f"Hola {cliente.nombre}," if cliente.nombre else "Hola,"
    if cliente.debito_automatico:
        linea = f"tu cuota de monotributo se debita automáticamente el {fecha}{sufijo}."
    else:
        linea = f"tu cuota de monotributo vence el {fecha}{sufijo}."

    asunto = f"Vencimiento de tu monotributo — {_MESES[hoy.month - 1]}"
    html = f"""\
<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.6;max-width:520px">
  <p>{saludo}</p>
  <p>Te recordamos que {linea}</p>
  <p style="color:#444">Cualquier duda, escribile a tu contador.</p>
  <p style="color:#8a8a8a;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
    Te lo acerca Órbita, la plataforma con la que tu contador administra tus impuestos.
  </p>
</div>"""
    texto = (
        f"{saludo}\n\n"
        f"Te recordamos que {linea}\n\n"
        "Cualquier duda, escribile a tu contador.\n\n"
        "Te lo acerca Órbita, la plataforma con la que tu contador administra tus impuestos."
    )
    return asunto, html, texto


def preparar(db: Session, cliente: models.ClienteARCA, hoy: dt.date | None = None) -> dict | None:
    """Resuelve la frescura del importe y arma el mail de un cliente. Devuelve un dict listo para
    enviar/previsualizar ({asunto, html, texto, importe_fresco, destino}) o None si no hay
    vencimiento para recordar. `destino` es el email cargado del cliente (puede faltar)."""
    hoy = hoy or dt.datetime.now(dt.timezone.utc).date()
    fresco = importe_fresco(db, cliente.cuit, hoy)
    armado = armar_mail(cliente, hoy, fresco)
    if armado is None:
        return None
    asunto, html, texto = armado
    return {
        "asunto": asunto,
        "html": html,
        "texto": texto,
        "importe_fresco": fresco,
        "destino": cliente.email_cliente,
    }


def _master_activo(db: Session, usuario_id: int | None, cache: dict[int | None, bool]) -> bool:
    """¿El estudio dueño de este cliente tiene ACTIVADO el envío automático? El master vive en la
    config del TITULAR (config_json.vencimientos.activo); para un empleado se mira la del titular.
    Cachea por usuario_id para no releer la config en cada cliente."""
    if usuario_id in cache:
        return cache[usuario_id]
    activo = False
    u = db.get(models.Usuario, usuario_id) if usuario_id else None
    if u is not None:
        titular = db.get(models.Usuario, u.titular_id) if u.titular_id else u
        if titular is not None and titular.config_json:
            try:
                cfg = json.loads(titular.config_json)
                activo = bool((cfg.get("vencimientos") or {}).get("activo"))
            except (ValueError, TypeError):
                activo = False
    cache[usuario_id] = activo
    return activo


def pasar_vencimientos(db: Session, hoy: dt.date | None = None) -> dict:
    """Pase mensual: envía por mail el recordatorio del próximo vencimiento a cada cliente elegible.

    Elegible = monitoreo activo + monotributista con próximo vencimiento + email cargado + no excluido
    (venc_avisos) + SIN problema de clave (si no podemos acceder al cliente, su vencimiento está viejo
    y no lo mandamos) + el estudio tiene el master ON + todavía no se le avisó ESTE período. Idempotente:
    al enviar marca `venc_notificado_periodo`, así un reinicio del worker no reenvía. Si el mail no se
    entrega (SMTP caído), no marca y se reintenta en la próxima pasada. Devuelve un resumen."""
    hoy = hoy or dt.datetime.now(dt.timezone.utc).date()
    periodo = hoy.strftime("%Y-%m")
    candidatos = db.scalars(
        select(models.ClienteARCA).where(
            models.ClienteARCA.activo.is_(True),
            models.ClienteARCA.prox_venc_fecha.isnot(None),
            models.ClienteARCA.email_cliente.isnot(None),
            # Sin problema de clave: esos clientes no se sincronizan, así que su próximo vencimiento
            # quedó congelado en una fecha vieja (posiblemente ya pasada). No los avisamos.
            models.ClienteARCA.clave_invalida.is_(False),
            models.ClienteARCA.clave_requiere_cambio.is_(False),
            models.ClienteARCA.contribuyente_irregular.is_(False),
            or_(
                models.ClienteARCA.venc_avisos.is_(None),
                models.ClienteARCA.venc_avisos.is_(True),
            ),
            or_(
                models.ClienteARCA.venc_notificado_periodo.is_(None),
                models.ClienteARCA.venc_notificado_periodo != periodo,
            ),
        )
    ).all()

    cache: dict[int | None, bool] = {}
    enviados = 0
    elegibles = 0
    for c in candidatos:
        if not _master_activo(db, c.usuario_id, cache):
            continue
        elegibles += 1
        prep = preparar(db, c, hoy)
        if prep is None:  # sin fecha (no debería llegar acá por el filtro), nada para mandar
            continue
        if email_svc.enviar_email(c.email_cliente, prep["asunto"], prep["html"], prep["texto"]):
            c.venc_notificado_periodo = periodo
            db.commit()
            enviados += 1
    return {"periodo": periodo, "candidatos": len(candidatos), "elegibles": elegibles, "enviados": enviados}


def enviar_prueba(db: Session, cliente: models.ClienteARCA, destino: str) -> dict:
    """Manda a `destino` (la casilla del contador) el mail tal como le llegaría al cliente, para que
    vea cómo queda antes de automatizar. Devuelve {enviado, destino, asunto, html, texto, motivo}.
    Nunca envía al cliente final."""
    prep = preparar(db, cliente)
    if prep is None:
        return {
            "enviado": False,
            "destino": destino,
            "asunto": None,
            "html": None,
            "texto": None,
            "motivo": "Este cliente todavía no tiene un próximo vencimiento para recordar.",
        }
    enviado = email_svc.enviar_email(destino, prep["asunto"], prep["html"], prep["texto"])
    return {
        "enviado": enviado,
        "destino": destino,
        "asunto": prep["asunto"],
        "html": prep["html"],
        "texto": prep["texto"],
        "motivo": None if enviado else "No se pudo enviar el correo de prueba en este momento.",
    }
