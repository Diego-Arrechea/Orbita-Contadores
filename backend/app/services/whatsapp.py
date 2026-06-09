"""
Envío de WhatsApp vía Twilio (API REST).

Interfaz DESACOPLADA del proveedor a propósito: `enviar_whatsapp(destino, mensaje)` es lo único
que conocen los que la usan. Hoy detrás está Twilio; mañana puede ser Meta Cloud API sin tocar a
los callers. Best-effort: si no hay credenciales en .env, es un no-op (no rompe el flujo).

Doc Twilio: https://www.twilio.com/docs/whatsapp/api
"""
from __future__ import annotations

import logging

import requests

from ..config import settings

logger = logging.getLogger("orbita.whatsapp")

API_BASE = "https://api.twilio.com/2010-04-01"
TIMEOUT = 15  # segundos


def configurado() -> bool:
    return bool(
        settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_whatsapp_from
    )


def _a_whatsapp(numero: str) -> str:
    """Normaliza un número a 'whatsapp:+<E164>', pensado para Argentina:
    - respeta el país si ya viene en internacional (con '+');
    - si es local (sin '+'), asume Argentina, saca el 0 inicial del área y agrega el 54;
    - asegura el 9 de móvil de AR.
    Limitación conocida: no quita el '15' intercalado de un celular escrito en formato local
    (ej. '0221 15-5936464'); para esos casos, guardá el número en internacional o sin el 15."""
    n = numero.strip()
    if n.startswith("whatsapp:"):
        return n
    tiene_mas = n.startswith("+")
    d = "".join(c for c in n if c.isdigit())
    if tiene_mas:
        # Internacional: respetamos el código de país; sólo arreglamos el 9 si es Argentina.
        if d.startswith("54") and not d.startswith("549"):
            d = "549" + d[2:]
        return f"whatsapp:+{d}"
    # Local (sin '+'): asumimos Argentina.
    if d.startswith("0"):
        d = d[1:]  # 0 inicial del código de área
    if not d.startswith("54"):
        d = "54" + d
    if not d.startswith("549"):
        d = "549" + d[2:]  # 9 de móvil
    return f"whatsapp:+{d}"


def enviar_whatsapp(destino: str, mensaje: str) -> str:
    """Envía un WhatsApp y devuelve el SID del mensaje (o 'desactivado' si no hay credenciales).
    Lanza requests.HTTPError/RequestException ante un error real de red o de la API de Twilio."""
    if not configurado():
        return "desactivado"
    sid = settings.twilio_account_sid
    r = requests.post(
        f"{API_BASE}/Accounts/{sid}/Messages.json",
        auth=(sid, settings.twilio_auth_token),
        data={
            "From": _a_whatsapp(settings.twilio_whatsapp_from),
            "To": _a_whatsapp(destino),
            "Body": mensaje,
        },
        timeout=TIMEOUT,
    )
    if not r.ok:
        raise requests.HTTPError(f"Twilio {r.status_code}: {r.text[:300]}")
    return r.json().get("sid", "")


def intentar_enviar(destino: str, mensaje: str) -> None:
    """Best-effort: nunca lanza (loguea y sigue). Para usar dentro del sync de alertas, donde un
    fallo de WhatsApp no debe tumbar la sincronización."""
    try:
        res = enviar_whatsapp(destino, mensaje)
        if res != "desactivado":
            logger.info("WhatsApp enviado a %s (sid %s)", destino, res)
    except Exception:  # noqa: BLE001 — best-effort a propósito
        logger.warning("WhatsApp: no se pudo enviar a %s", destino, exc_info=True)
