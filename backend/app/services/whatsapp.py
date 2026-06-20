"""
Envío de WhatsApp vía el gateway de Órbita (app de mensajería, worker Baileys).

Interfaz DESACOPLADA del proveedor a propósito: `enviar_whatsapp(destino, mensaje)` es lo único que
conocen los callers (el motor de alertas). Detrás, posteamos al endpoint de ALTO nivel
`/api/bot/propose` con `mode:"autopilot"`: él resuelve/crea el contacto y la conversación, persiste el
mensaje saliente y lo envía por Baileys desde el WhatsApp de Contadores. NO le pegamos al worker
crudo (`/send`) a propósito: ese es el primitivo de bajo nivel y no deja rastro en la UI/DB.

Best-effort: si no hay secreto configurado, es un no-op (no rompe el flujo de alertas).

Auth: header `x-bot-secret` con el BOT_WEBHOOK_SECRET de prod (en settings.whatsapp_bot_secret).
"""
from __future__ import annotations

import logging

import requests

from ..config import settings

logger = logging.getLogger("orbita.whatsapp")

TIMEOUT = 20  # segundos


def configurado() -> bool:
    return bool(
        settings.whatsapp_bot_url and settings.whatsapp_inbox_id and settings.whatsapp_bot_secret
    )


def _a_telefono(numero: str) -> str:
    """Normaliza un número al formato que pide el gateway: SÓLO dígitos, internacional, SIN '+'
    (ej. '5491112345678'). Pensado para Argentina:
    - si viene internacional (con '+'), respeta el país y sólo asegura el 9 de móvil AR;
    - si es local (sin '+'), asume Argentina: saca el 0 inicial del área y antepone 54 + el 9 móvil.
    Limitación conocida: no quita el '15' intercalado de un celular escrito en formato local."""
    n = numero.strip()
    tiene_mas = n.startswith("+")
    d = "".join(c for c in n if c.isdigit())
    if tiene_mas:
        # Internacional: respetamos el código de país; sólo arreglamos el 9 si es Argentina.
        if d.startswith("54") and not d.startswith("549"):
            d = "549" + d[2:]
        return d
    # Local (sin '+'): asumimos Argentina.
    if d.startswith("0"):
        d = d[1:]  # 0 inicial del código de área
    if not d.startswith("54"):
        d = "54" + d
    if not d.startswith("549"):
        d = "549" + d[2:]  # 9 de móvil
    return d


def enviar_whatsapp(destino: str, mensaje: str) -> str:
    """Envía un WhatsApp y devuelve el conversationId (o 'desactivado' si no hay credenciales).
    Lanza requests.HTTPError/RequestException ante un error real de red o de la API del gateway."""
    if not configurado():
        return "desactivado"
    r = requests.post(
        settings.whatsapp_bot_url,
        headers={
            "x-bot-secret": settings.whatsapp_bot_secret,
            "Content-Type": "application/json",
        },
        json={
            "inboxId": settings.whatsapp_inbox_id,
            "phone": _a_telefono(destino),
            "content": mensaje,
            "mode": "autopilot",
        },
        timeout=TIMEOUT,
    )
    if not r.ok:
        raise requests.HTTPError(f"WhatsApp gateway {r.status_code}: {r.text[:300]}")
    data = r.json()
    if not data.get("ok"):
        raise requests.HTTPError(f"WhatsApp gateway rechazó el envío: {str(data)[:300]}")
    return str(data.get("conversationId", "")) or "ok"


def intentar_enviar(destino: str, mensaje: str) -> None:
    """Best-effort: nunca lanza (loguea y sigue). Para usar dentro del sync de alertas, donde un
    fallo de WhatsApp no debe tumbar la sincronización."""
    try:
        res = enviar_whatsapp(destino, mensaje)
        if res != "desactivado":
            logger.info("WhatsApp enviado a %s (conversación %s)", destino, res)
    except Exception:  # noqa: BLE001 — best-effort a propósito
        logger.warning("WhatsApp: no se pudo enviar a %s", destino, exc_info=True)
