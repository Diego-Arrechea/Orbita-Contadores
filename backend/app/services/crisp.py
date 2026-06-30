"""
Sincronización de contadores con el CRM de Crisp (People).

Cada cuenta de Órbita (un `models.Usuario`) se refleja como un contacto en Crisp, así el equipo
ve en el inbox con qué estudio habla y queda una lista de contactos para soporte/seguimiento.

Usa la REST API de Crisp con un *Website Token* (identifier + key) que se saca en el panel:
Settings → Workspace Settings → Advanced Configuration → API Token (tier "website", 10k req/día).
También sirve un plugin token del Marketplace (en ese caso, CRISP_TIER=plugin en .env).
Si las credenciales no están seteadas en .env, todo esto es un no-op: el registro sigue
funcionando igual (no queremos que un problema con Crisp tumbe el alta de un contador).

Doc: https://docs.crisp.chat/references/rest-api/v1/  (People → Add New People Profile)
"""
from __future__ import annotations

import logging

import requests

from .. import models
from ..config import settings

logger = logging.getLogger("orbita.crisp")

API_BASE = "https://api.crisp.chat/v1"
TIMEOUT = 10  # segundos


def _configurado() -> bool:
    return bool(
        settings.crisp_enabled
        and settings.crisp_website_id
        and settings.crisp_token_identifier
        and settings.crisp_token_key
    )


def _sesion() -> tuple[str, tuple[str, str], dict[str, str]]:
    """Devuelve (base_people, auth, headers) listos para pegarle a la API de Crisp.
    El tier sale de settings: "website" para un Website Token (lo normal) o "plugin" para un
    token del Marketplace."""
    base = f"{API_BASE}/website/{settings.crisp_website_id}/people"
    auth = (settings.crisp_token_identifier, settings.crisp_token_key)
    headers = {"X-Crisp-Tier": settings.crisp_tier}
    return base, auth, headers


def sincronizar_contacto(usuario: models.Usuario) -> str:
    """Crea (o completa) el contacto del contador en Crisp. Idempotente: si ya existe, no falla
    y le actualiza los datos del estudio.

    Devuelve: "creado" | "ya_existia" | "desactivado" (sin credenciales).
    Lanza requests.HTTPError / requests.RequestException ante un error real de red o de la API.
    """
    if not _configurado():
        return "desactivado"

    base, auth, headers = _sesion()
    nombre = f"{usuario.nombre} {usuario.apellido}".strip() or usuario.email

    # 1) Alta del perfil. 409 = el contacto ya existía (lo tratamos como éxito).
    perfil = {
        "email": usuario.email,
        "person": {"nickname": nombre, "phone": usuario.telefono or ""},
        "segments": ["contador", "orbita-app"],
    }
    r = requests.post(f"{base}/profile", auth=auth, headers=headers, json=perfil, timeout=TIMEOUT)

    if r.status_code == 409:
        estado, people_id = "ya_existia", usuario.email  # Crisp acepta el email como people_id
    elif r.ok:
        estado = "creado"
        people_id = r.json().get("data", {}).get("people_id") or usuario.email
    else:
        r.raise_for_status()

    # 2) Datos del estudio, para que aparezcan en la ficha del contacto en el inbox.
    datos = {
        "data": {
            "estudio": usuario.estudio,
            "cuit": usuario.cuit,
            "telefono": usuario.telefono,
            "matricula": usuario.matricula or "",
            "origen": "registro-orbita",
        }
    }
    rd = requests.put(f"{base}/data/{people_id}", auth=auth, headers=headers, json=datos, timeout=TIMEOUT)
    if not rd.ok:  # no es crítico: el contacto ya quedó creado, sólo no se enriqueció
        logger.warning("Crisp: no se pudieron guardar los datos de %s (%s)", usuario.email, rd.status_code)

    return estado


def intentar_sincronizar(usuario: models.Usuario) -> None:
    """Versión best-effort para el flujo de registro: nunca lanza (loguea y sigue), así un
    problema con Crisp jamás rompe el alta del contador."""
    try:
        estado = sincronizar_contacto(usuario)
        if estado != "desactivado":
            logger.info("Crisp: contacto %s para %s", estado, usuario.email)
    except Exception:  # noqa: BLE001 — best-effort a propósito
        logger.warning("Crisp: no se pudo sincronizar el contacto de %s", usuario.email, exc_info=True)
