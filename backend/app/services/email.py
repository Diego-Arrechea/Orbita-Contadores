"""
Envío de emails transaccionales por SMTP (recuperación de contraseña).

Usa la librería estándar (`smtplib` + `email.message`): no agrega dependencias. Cualquier proveedor
SMTP sirve (Gmail con App Password, Resend, SendGrid, Mailgun…); las credenciales van en .env
(SMTP_HOST/PORT/USER/PASSWORD/FROM, ver config.py).

Si SMTP no está configurado (host o user vacíos), el envío es un NO-OP: no rompe nada y loguea el
contenido (incluido el enlace de reset) para poder usarlo en desarrollo. Mismo criterio best-effort
que la sync con Crisp: un problema con el correo nunca debe tumbar el flujo que lo dispara.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from .. import models
from ..config import settings

logger = logging.getLogger("orbita.email")

TIMEOUT = 15  # segundos


def _configurado() -> bool:
    return bool(settings.smtp_host and settings.smtp_user)


def enviar_email(destino: str, asunto: str, cuerpo_html: str, cuerpo_texto: str = "") -> bool:
    """Manda un email best-effort. Devuelve True si se entregó al servidor SMTP, False si no.
    Si SMTP no está configurado, loguea el cuerpo y devuelve False sin lanzar."""
    if not _configurado():
        logger.warning(
            "SMTP sin configurar: no se envió el email a %s. Asunto: %s\n%s",
            destino,
            asunto,
            cuerpo_texto or cuerpo_html,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = asunto
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = destino
    msg.set_content(cuerpo_texto or "Abrí este correo en un cliente que soporte HTML.")
    msg.add_alternative(cuerpo_html, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT) as smtp:
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception:  # red, auth, etc.: best-effort, no rompe el flujo que lo dispara
        logger.exception("Falló el envío de email a %s", destino)
        return False


def enviar_link_reset(usuario: models.Usuario, token: str) -> bool:
    """Arma y manda el correo de recuperación de contraseña con el enlace al frontend."""
    link = f"{settings.app_base_url.rstrip('/')}/recuperar?token={token}"
    asunto = "Restablecé tu contraseña de Órbita"
    cuerpo_html = f"""\
<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">
  <p>Hola {usuario.nombre},</p>
  <p>Recibimos un pedido para restablecer la contraseña de tu cuenta de Órbita.</p>
  <p>
    <a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;
       text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">
      Crear una nueva contraseña
    </a>
  </p>
  <p style="color:#666;font-size:13px">
    El enlace vence en {settings.reset_token_horas} hora(s). Si no pediste este cambio, ignorá
    este correo: tu contraseña actual sigue siendo válida.
  </p>
</div>"""
    cuerpo_texto = (
        f"Hola {usuario.nombre},\n\n"
        "Recibimos un pedido para restablecer la contraseña de tu cuenta de Órbita.\n"
        f"Abrí este enlace para crear una nueva contraseña (vence en {settings.reset_token_horas} "
        f"hora/s):\n{link}\n\n"
        "Si no pediste este cambio, ignorá este correo."
    )
    return enviar_email(usuario.email, asunto, cuerpo_html, cuerpo_texto)
