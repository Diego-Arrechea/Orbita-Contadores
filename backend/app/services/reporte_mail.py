"""Envío del reporte del cliente por mail (pedido de los contadores, reunión 1-oct-2026).

El reporte se calcula en el front (mismos números que la pantalla del reporte: situación, historial,
alertas, movimientos y acciones), que manda el cuerpo HTML ya armado. Acá se valida, se envuelve con
la cabecera/pie del estudio y se envía:
- From: el remitente de Órbita (decisión de producto: el mail al cliente final sale con la marca de
  Órbita; la marca propia del estudio es un extra futuro, ver memoria vencimientos-remitente).
- Reply-To: el mail del contador, así el cliente le responde a él.
- Copia opcional al contador.

Como el cuerpo viene del navegador, se cuida que el endpoint no sirva para mandar cualquier cosa:
tope de tamaño (schema), sin scripts, y un límite de envíos por hora por usuario."""
from __future__ import annotations

import html as html_lib
import re
import threading
import time
from collections import defaultdict, deque

from .. import models
from . import email as email_svc

LIMITE_POR_HORA = 40
_envios: dict[int, deque] = defaultdict(deque)
_lock = threading.Lock()

_PELIGROSO = re.compile(r"<\s*script|javascript:|<\s*iframe|<\s*object|<\s*embed|<[^>]*\son\w+\s*=", re.I)


class EnvioRechazado(Exception):
    def __init__(self, mensaje: str, status: int = 400):
        super().__init__(mensaje)
        self.status = status


def _registrar_envio(usuario_id: int) -> None:
    """Límite simple de envíos por hora por usuario (en memoria: alcanza para frenar un abuso)."""
    ahora = time.time()
    with _lock:
        q = _envios[usuario_id]
        while q and ahora - q[0] > 3600:
            q.popleft()
        if len(q) >= LIMITE_POR_HORA:
            raise EnvioRechazado(
                "Llegaste al límite de reportes enviados por hora. Probá de nuevo más tarde.", 429
            )
        q.append(ahora)


def envolver(cuerpo: str, *, estudio: str, contador: str | None) -> str:
    """Documento HTML del mail: el reporte armado por el front + pie con quién lo envía."""
    firma = html_lib.escape(estudio or "Tu estudio contable")
    quien = f" ({html_lib.escape(contador)})" if contador else ""
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="max-width:680px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2329;">
{cuerpo}
<p style="margin:20px 4px 0;font-size:12px;line-height:1.5;color:#6b7280;">
Te lo envía {firma}{quien}. Si tenés dudas, respondé este mail y le llega a tu contador.<br>
Documento informativo generado con Órbita. No reemplaza la consulta a los canales oficiales.
</p>
</div>
</body></html>"""


def enviar(
    *,
    usuario: models.Usuario,
    cliente: models.ClienteARCA,
    destino: str,
    copia_a_mi: bool,
    asunto: str,
    html: str,
    texto: str,
) -> bool:
    """Valida y manda el reporte. Lanza EnvioRechazado con copy de dominio si algo no corresponde;
    devuelve False si el servidor de correo no lo aceptó."""
    if _PELIGROSO.search(html):
        raise EnvioRechazado("El contenido del reporte no es válido.")
    asunto = " ".join(asunto.split())  # sin saltos de línea (no se inyectan cabeceras)
    _registrar_envio(usuario.id)
    cuerpo = envolver(html, estudio=usuario.estudio, contador=f"{usuario.nombre} {usuario.apellido}".strip())
    return email_svc.enviar_email(
        destino,
        asunto,
        cuerpo,
        texto,
        responder_a=usuario.email,
        copia=usuario.email if copia_a_mi and usuario.email and usuario.email.lower() != destino.lower() else None,
    )
