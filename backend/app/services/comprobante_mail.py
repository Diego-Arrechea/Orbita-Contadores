"""Envío por mail de un comprobante emitido desde la app (con su PDF adjunto) al receptor.

Pedido del contador de DURSO (15-oct-2026): poder cargar el mail del cliente al emitir y mandarle la
factura. Sale por el mismo SMTP que el reporte (marca Órbita en el From). Reply-To: el mail del
emisor si lo tenemos (es su factura), si no el del contador que la manda; así el receptor responde a
alguien que la conoce. Copia opcional al contador.

Se guarda a quién y cuándo se mandó (`ComprobanteEmitido.email_enviado_a/_en`): se muestra en la
lista y sirve para sugerir el mail la próxima vez que se le factura al mismo CUIT."""
from __future__ import annotations

import datetime as dt
import html as html_lib
import threading
import time
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models
from . import comprobante_pdf
from . import email as email_svc

LIMITE_POR_HORA = 60
_envios: dict[int, deque] = defaultdict(deque)
_lock = threading.Lock()

_NOMBRE = {11: "Factura C", 13: "Nota de Crédito C", 15: "Recibo C"}
_ARCHIVO = {11: "Factura_C", 13: "Nota_Credito_C", 15: "Recibo_C"}


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
                "Llegaste al límite de comprobantes enviados por hora. Probá de nuevo más tarde.", 429
            )
        q.append(ahora)


def _money(v) -> str:
    s = f"{float(v or 0):,.2f}"
    return "$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def numero_formateado(comp: models.ComprobanteEmitido) -> str:
    return f"{comp.punto_venta:05d}-{comp.numero:08d}"


def nombre_archivo(comp: models.ComprobanteEmitido) -> str:
    return f"{_ARCHIVO.get(comp.cbte_tipo, 'Comprobante')}_{numero_formateado(comp)}.pdf"


def email_sugerido(db: Session, cuit: str, doc_nro: str) -> str | None:
    """Último mail al que se le mandó un comprobante de este emisor a este receptor (por CUIT)."""
    doc = "".join(ch for ch in (doc_nro or "") if ch.isdigit())
    if not doc or doc == "0":
        return None
    fila = (
        db.query(models.ComprobanteEmitido.email_enviado_a)
        .filter(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.direccion == "emitido",
            models.ComprobanteEmitido.doc_nro == doc,
            models.ComprobanteEmitido.email_enviado_a.isnot(None),
        )
        .order_by(models.ComprobanteEmitido.email_enviado_en.desc())
        .first()
    )
    return fila[0] if fila else None


def _cuerpo(comp: models.ComprobanteEmitido, cliente: models.ClienteARCA, nombre_cbte: str) -> tuple[str, str]:
    emisor = html_lib.escape(cliente.nombre or "")
    numero = numero_formateado(comp)
    fecha = comp.fecha.strftime("%d/%m/%Y")
    total = _money(comp.imp_total)
    periodo_html = periodo_txt = ""
    if comp.fch_serv_desde and comp.fch_serv_hasta:
        p = f"{comp.fch_serv_desde.strftime('%d/%m/%Y')} al {comp.fch_serv_hasta.strftime('%d/%m/%Y')}"
        periodo_html = f'<tr><td style="padding:4px 0;color:#6b7280;">Período</td><td style="padding:4px 0;text-align:right;">{p}</td></tr>'
        periodo_txt = f"Período: {p}\n"
    vto_html = vto_txt = ""
    if comp.fch_vto_pago:
        v = comp.fch_vto_pago.strftime("%d/%m/%Y")
        vto_html = f'<tr><td style="padding:4px 0;color:#6b7280;">Vencimiento del pago</td><td style="padding:4px 0;text-align:right;">{v}</td></tr>'
        vto_txt = f"Vencimiento del pago: {v}\n"
    html = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2329;">
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;">
<p style="margin:0 0 6px;font-size:13px;color:#6b7280;">{emisor}</p>
<h1 style="margin:0 0 16px;font-size:20px;">{nombre_cbte} {numero}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;">Hola, te enviamos el comprobante adjunto en PDF.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<tr><td style="padding:4px 0;color:#6b7280;">Fecha</td><td style="padding:4px 0;text-align:right;">{fecha}</td></tr>
{periodo_html}{vto_html}
<tr><td style="padding:10px 0 0;font-weight:bold;border-top:1px solid #e5e7eb;">Importe total</td><td style="padding:10px 0 0;text-align:right;font-weight:bold;border-top:1px solid #e5e7eb;">{total}</td></tr>
</table>
</div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:#6b7280;">
Enviado en nombre de {emisor} con Órbita. Si tenés dudas sobre este comprobante, respondé este mail.
</p>
</div>
</body></html>"""
    texto = (
        f"{cliente.nombre}\n{nombre_cbte} {numero}\n\n"
        "Hola, te enviamos el comprobante adjunto en PDF.\n\n"
        f"Fecha: {fecha}\n{periodo_txt}{vto_txt}Importe total: {total}\n\n"
        f"Enviado en nombre de {cliente.nombre} con Órbita. Si tenés dudas sobre este comprobante, "
        "respondé este mail."
    )
    return html, texto


def enviar(
    db: Session,
    *,
    usuario: models.Usuario,
    cliente: models.ClienteARCA,
    comp: models.ComprobanteEmitido,
    destino: str,
    copia_a_mi: bool = False,
) -> None:
    """Manda el comprobante (PDF adjunto) a `destino` y registra el envío. Lanza EnvioRechazado con
    copy de dominio si no corresponde o si el servidor de correo no lo aceptó."""
    if not comp.cae or not comp.cae_vto:
        raise EnvioRechazado("Este comprobante no se puede enviar desde acá.", 404)
    destino = destino.strip()
    _registrar_envio(usuario.id)
    nombre_cbte = _NOMBRE.get(comp.cbte_tipo, "Comprobante")
    pdf = comprobante_pdf.generar(comp, cliente)
    html, texto = _cuerpo(comp, cliente, nombre_cbte)
    asunto = " ".join(f"{nombre_cbte} {numero_formateado(comp)} de {cliente.nombre or ''}".split())
    responder_a = (cliente.email_cliente or "").strip() or usuario.email
    copia = (
        usuario.email
        if copia_a_mi and usuario.email and usuario.email.lower() != destino.lower()
        else None
    )
    ok = email_svc.enviar_email(
        destino,
        asunto,
        html,
        texto,
        responder_a=responder_a,
        copia=copia,
        adjuntos=[(nombre_archivo(comp), pdf, "application/pdf")],
    )
    if not ok:
        raise EnvioRechazado(
            "No pudimos enviar el mail en este momento. Probá de nuevo en unos minutos.", 502
        )
    comp.email_enviado_a = destino
    comp.email_enviado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
