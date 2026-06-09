"""
Motor de alertas del backend (subset de "dato directo") + envío por WhatsApp.

A diferencia de la lógica completa del front (src/lib/alertas.ts), acá sólo derivamos las alertas
que salen de datos que el backend YA tiene en ClienteARCA (cuota, vencimiento, sync), sin recalcular
facturación/topes. Es suficiente para las notificaciones automáticas urgentes; las de tope y
recategorización se siguen viendo en la app.

Se ejecuta después del sync diario (scheduler) y también por el endpoint manual de prueba.
"""
from __future__ import annotations

import datetime as dt
import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from . import whatsapp
from .sincronizacion import ultima_extraccion

logger = logging.getLogger("orbita.alertas")

COOLDOWN_DIAS = 7  # no reenviar la misma alerta (cuit+tipo) antes de N días
VENC_AVISO_DIAS = 7  # vencimiento de cuota dentro de N días → alerta

_MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12,
}


def _parse_fecha_ar(s: str | None) -> dt.date | None:
    """Parsea 'dd-mmm-aaaa' en español (ej. '10-jun-2026') como devuelve el portal Monotributo."""
    if not s:
        return None
    m = re.match(r"\s*(\d{1,2})-([a-zA-Z]+)-(\d{4})", s)
    if not m:
        return None
    mes = _MESES.get(m.group(2).lower()[:3])
    if not mes:
        return None
    try:
        return dt.date(int(m.group(3)), mes, int(m.group(1)))
    except ValueError:
        return None


def alertas_de_dato_directo(db: Session, cliente: models.ClienteARCA) -> list[dict]:
    """Alertas derivadas de datos ya guardados (sin recalcular facturación/topes)."""
    alertas: list[dict] = []

    # Cuota del mes impaga.
    if cliente.cuota_estado == "con-deuda":
        if cliente.cuota_deuda:
            monto = f"{float(cliente.cuota_deuda):,.0f}".replace(",", ".")  # formato AR: $50.000
            detalle = f" (debe ${monto})"
        else:
            detalle = ""
        alertas.append({"tipo": "cuota", "texto": f"{cliente.nombre}: cuota del mes impaga{detalle}"})

    # Vencimiento de cuota próximo.
    venc = _parse_fecha_ar(cliente.prox_venc_fecha)
    if venc is not None:
        dias = (venc - dt.date.today()).days
        if 0 <= dias <= VENC_AVISO_DIAS:
            alertas.append(
                {"tipo": "vencimiento", "texto": f"{cliente.nombre}: vence la cuota el {cliente.prox_venc_fecha} (en {dias} días)"}
            )

    # Sincronización con ARCA fallida.
    ult = ultima_extraccion(db, cliente.cuit)
    if ult is not None and ult.resultado == "fallida":
        alertas.append({"tipo": "sync", "texto": f"{cliente.nombre}: la sincronización con ARCA falló"})

    return alertas


def _ya_enviada(db: Session, cuit: str, tipo: str) -> bool:
    """¿Ya se notificó esta alerta (cuit+tipo) dentro del cooldown?"""
    limite = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=COOLDOWN_DIAS)
    return (
        db.scalar(
            select(models.AlertaEnviada).where(
                models.AlertaEnviada.cuit == cuit,
                models.AlertaEnviada.tipo == tipo,
                models.AlertaEnviada.enviada_en >= limite,
            )
        )
        is not None
    )


def evaluar_y_notificar(db: Session, solo_usuario_id: int | None = None) -> dict:
    """Por cada contador, junta las alertas NUEVAS (respeta cooldown) de sus clientes y le manda UN
    resumen por WhatsApp. Si `solo_usuario_id`, evalúa sólo ese contador (para probar manualmente).
    Devuelve un resumen {contadores_notificados, alertas_nuevas, mensajes_enviados}."""
    q = select(models.Usuario)
    if solo_usuario_id is not None:
        q = q.where(models.Usuario.id == solo_usuario_id)
    usuarios = db.scalars(q).all()

    res = {"contadores_notificados": 0, "alertas_nuevas": 0, "mensajes_enviados": 0}
    for u in usuarios:
        if not u.telefono:
            continue
        clientes = db.scalars(
            select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == u.id)
        ).all()

        nuevas: list[dict] = []
        for c in clientes:
            for a in alertas_de_dato_directo(db, c):
                if not _ya_enviada(db, c.cuit, a["tipo"]):
                    nuevas.append({**a, "cuit": c.cuit})

        res["alertas_nuevas"] += len(nuevas)
        if not nuevas:
            continue

        lineas = "\n".join(f"• {a['texto']}" for a in nuevas)
        mensaje = (
            f"🔔 *Órbita* — {len(nuevas)} alerta(s) en tu cartera\n\n{lineas}\n\n"
            f"Entrá a Órbita para verlas en detalle."
        )
        try:
            whatsapp.enviar_whatsapp(u.telefono, mensaje)
            ahora = dt.datetime.now(dt.timezone.utc)
            for a in nuevas:
                db.add(models.AlertaEnviada(usuario_id=u.id, cuit=a["cuit"], tipo=a["tipo"], enviada_en=ahora))
            db.commit()
            res["contadores_notificados"] += 1
            res["mensajes_enviados"] += 1
        except Exception:  # noqa: BLE001 — best-effort: un fallo no frena al resto
            db.rollback()
            logger.warning("No se pudo notificar a %s", u.email, exc_info=True)

    return res
