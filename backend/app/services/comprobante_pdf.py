"""
Representación impresa (PDF) de un comprobante emitido desde la app.

WSFEv1 sólo devuelve el CAE: la representación impresa la genera el emisor (RG 5616 / RG 4291),
con el código QR oficial de ARCA en el pie. Este módulo arma ese PDF a partir del comprobante ya
persistido (`ComprobanteEmitido`) + los datos del emisor (`ClienteARCA`), sin volver a llamar a ARCA.

Sólo aplica a Factura C (11) y Nota de Crédito C (13) de monotributo (clase C, sin IVA discriminado).
El layout replica el formato oficial de AFIP: caja con la letra del comprobante arriba al centro,
bloque emisor (izquierda) / numeración (derecha), datos del receptor, detalle, total y pie con QR+CAE.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
from io import BytesIO

import segno
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .. import models

# QR oficial de ARCA: el contenido es esta URL con el payload en base64 (RG 4291).
QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/?p="

# Tipo de comprobante -> (nombre, letra, código impreso de 3 dígitos).
_TIPOS = {
    11: ("FACTURA", "C", "011"),
    13: ("NOTA DE CRÉDITO", "C", "013"),
}

# Condición frente al IVA (RG 5616) -> etiqueta para el comprobante impreso.
_COND_IVA = {
    1: "Responsable Inscripto",
    4: "IVA Sujeto Exento",
    5: "Consumidor Final",
    6: "Responsable Monotributo",
}

# Paleta sobria (factura = documento serio, monocromo con grises).
_INK = (0.13, 0.14, 0.17)      # texto principal
_MUTED = (0.42, 0.44, 0.49)    # etiquetas / secundario
_LINE = (0.74, 0.76, 0.80)     # bordes
_HAIR = (0.86, 0.88, 0.91)     # líneas finas internas
_FILL = (0.955, 0.96, 0.97)    # fondos suaves (cabecera de tabla)


def _money(v) -> str:
    """1234.5 -> '$ 1.234,50' (formato AR)."""
    s = f"{float(v or 0):,.2f}"  # '1,234.50'
    return "$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def _cantidad(v) -> str:
    """2 -> '2,00' (formato AR, sin signo pesos)."""
    return f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _parse_items(raw) -> list[dict]:
    """Detalle de renglones persistido (JSON [{descripcion, cantidad, precio_unitario}]).
    [] si no hay desglose o el JSON es inválido → el PDF cae al renglón único por importe total."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return data if isinstance(data, list) else []


def _fecha_ddmmyyyy(d: dt.date) -> str:
    return d.strftime("%d/%m/%Y")


def _yyyymmdd_a_ddmmyyyy(s: str) -> str:
    if s and len(s) == 8 and s.isdigit():
        return f"{s[6:8]}/{s[4:6]}/{s[0:4]}"
    return s or "—"


def _qr_payload(comp: models.ComprobanteEmitido) -> str:
    """Arma el contenido del QR de ARCA (URL + JSON en base64)."""
    doc_nro = (comp.doc_nro or "").strip()
    con_doc = doc_nro not in ("", "0")
    data = {
        "ver": 1,
        "fecha": comp.fecha.strftime("%Y-%m-%d"),
        "cuit": int(comp.cuit),
        "ptoVta": int(comp.punto_venta),
        "tipoCmp": int(comp.cbte_tipo),
        "nroCmp": int(comp.numero),
        "importe": round(float(comp.imp_total or 0), 2),
        "moneda": "PES",
        "ctz": 1,
        "tipoDocRec": 80 if con_doc else 99,  # 80 CUIT · 99 consumidor final
        "nroDocRec": int(doc_nro) if con_doc else 0,
        "tipoCodAut": "E",  # E = CAE
        "codAut": int(comp.cae) if (comp.cae or "").isdigit() else comp.cae,
    }
    cod = base64.b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    return f"{QR_BASE_URL}{cod}"


def _qr_imagen(contenido: str) -> ImageReader:
    qr = segno.make(contenido, error="m")
    buf = BytesIO()
    qr.save(buf, kind="png", scale=10, border=0)
    buf.seek(0)
    return ImageReader(buf)


def _emisor_fiscal(cliente: models.ClienteARCA) -> dict:
    try:
        return json.loads(cliente.emisor_fiscal_json) if cliente.emisor_fiscal_json else {}
    except (ValueError, TypeError):
        return {}


def _domicilio_emisor(fiscal: dict) -> str | None:
    """'Av. Siempreviva 742, La Plata, Buenos Aires (CP 1900)' a partir del snapshot del padrón."""
    if not fiscal.get("domicilio"):
        return None
    partes = [fiscal["domicilio"]]
    loc = ", ".join(x for x in (fiscal.get("localidad"), fiscal.get("provincia")) if x)
    if loc:
        partes.append(loc)
    txt = ", ".join(partes)
    if fiscal.get("cod_postal"):
        txt += f" (CP {fiscal['cod_postal']})"
    return txt


def _set(c, color) -> None:
    c.setFillColorRGB(*color)


def _truncar(c, texto: str, font: str, size: float, max_w: float) -> str:
    """Recorta `texto` para que entre en `max_w`, agregando '…' y sin dejar signos colgando."""
    if c.stringWidth(texto, font, size) <= max_w:
        return texto
    while texto and c.stringWidth(texto + "…", font, size) > max_w:
        texto = texto[:-1]
    return texto.rstrip(" ,(-") + "…"


def _etiqueta_valor(c, x: float, y: float, etiqueta: str, valor: str, size: int = 8.5) -> None:
    """Dibuja 'Etiqueta: valor' con la etiqueta en gris y el valor en tinta, en una línea."""
    c.setFont("Helvetica", size)
    _set(c, _MUTED)
    c.drawString(x, y, etiqueta)
    ancho_et = c.stringWidth(etiqueta, "Helvetica", size)
    c.setFont("Helvetica-Bold", size)
    _set(c, _INK)
    c.drawString(x + ancho_et + 1.5 * mm, y, valor)


def generar(comp: models.ComprobanteEmitido, cliente: models.ClienteARCA) -> bytes:
    """Devuelve el PDF (bytes) de la representación impresa del comprobante."""
    nombre_cbte, letra, codigo = _TIPOS.get(comp.cbte_tipo, ("COMPROBANTE", "C", "000"))
    fiscal = _emisor_fiscal(cliente)
    domicilio = _domicilio_emisor(fiscal)
    condicion_emisor = (
        "Responsable Monotributo" if (cliente.regimen or "monotributo") == "monotributo"
        else "Responsable Inscripto"
    )
    doc_nro = (comp.doc_nro or "").strip()
    receptor_con_doc = doc_nro not in ("", "0")

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    ancho, alto = A4
    M = 14 * mm
    der = ancho - M
    cx = ancho / 2

    # ════════════════════════════════════════════════════════════════════════
    # ENCABEZADO — caja partida al medio con la letra del comprobante arriba
    # ════════════════════════════════════════════════════════════════════════
    enc_top = alto - M
    enc_h = 33 * mm
    enc_bot = enc_top - enc_h
    c.setLineWidth(0.9)
    _set(c, _LINE)
    c.setStrokeColorRGB(*_LINE)
    c.rect(M, enc_bot, der - M, enc_h)
    c.line(cx, enc_bot, cx, enc_top - 9 * mm)  # divisor (cortado donde baja la caja de la letra)

    # Caja de la letra, centrada sobre el borde superior. La letra y el código van ARRIBA, dentro
    # del recuadro (no colgando por debajo).
    lado = 16 * mm
    lb_x, lb_y = cx - lado / 2, enc_top - lado / 2
    c.setFillColorRGB(1, 1, 1)
    c.rect(lb_x, lb_y, lado, lado, fill=1, stroke=1)
    _set(c, _INK)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(cx, enc_top - 1.5 * mm, letra)
    _set(c, _MUTED)
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(cx, enc_top - 6 * mm, f"CÓD. {codigo}")

    # ── Columna izquierda: emisor ──
    xi = M + 6 * mm
    limite_izq = cx - 9 * mm  # no invadir la caja de la letra / la columna derecha
    y = enc_top - 13 * mm
    _set(c, _INK)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(xi, y, _truncar(c, cliente.nombre or "—", "Helvetica-Bold", 15, limite_izq - xi))
    y -= 7.5 * mm
    _etiqueta_valor(c, xi, y, "CUIT:", str(comp.cuit))
    y -= 5 * mm
    _etiqueta_valor(c, xi, y, "Condición frente al IVA:", condicion_emisor)
    if domicilio:
        y -= 5 * mm
        lab_w = c.stringWidth("Domicilio:", "Helvetica", 8.5)
        dom_fit = _truncar(c, domicilio, "Helvetica-Bold", 8.5, limite_izq - (xi + lab_w + 1.5 * mm))
        _etiqueta_valor(c, xi, y, "Domicilio:", dom_fit)

    # ── Columna derecha: comprobante (arranca despejada de la caja de la letra) ──
    xd = cx + 12 * mm
    y = enc_top - 13 * mm
    _set(c, _INK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(xd, y, nombre_cbte)
    y -= 9 * mm
    _etiqueta_valor(c, xd, y, "Punto de Venta:", f"{comp.punto_venta:05d}", size=9)
    _etiqueta_valor(c, xd + 42 * mm, y, "Comp. Nro:", f"{comp.numero:08d}", size=9)
    y -= 5.5 * mm
    _etiqueta_valor(c, xd, y, "Fecha de Emisión:", _fecha_ddmmyyyy(comp.fecha), size=9)

    # ════════════════════════════════════════════════════════════════════════
    # RECEPTOR
    # ════════════════════════════════════════════════════════════════════════
    rec_top = enc_bot - 5 * mm
    rec_h = 13 * mm
    c.setLineWidth(0.6)
    _set(c, _LINE)
    c.setStrokeColorRGB(*_LINE)
    c.rect(M, rec_top - rec_h, der - M, rec_h)
    if receptor_con_doc:
        ident_et, ident_val = "CUIT:", doc_nro
        # Condición real elegida al emitir; si la fila es vieja (sin dato) no la inventamos.
        cond_rec = _COND_IVA.get(comp.condicion_iva_receptor or 0, "—")
    else:
        ident_et, ident_val = "Receptor:", "Consumidor Final"
        cond_rec = "Consumidor Final"
    _etiqueta_valor(c, M + 4 * mm, rec_top - 5 * mm, ident_et, ident_val)
    _etiqueta_valor(c, M + 4 * mm, rec_top - 10 * mm, "Condición frente al IVA:", cond_rec)

    # ════════════════════════════════════════════════════════════════════════
    # DETALLE — clase C: un renglón (cantidad 1 × importe)
    # ════════════════════════════════════════════════════════════════════════
    tab_top = rec_top - rec_h - 7 * mm
    head_h = 7 * mm
    # columnas
    x_cant = der - 62 * mm
    x_punit = der - 34 * mm
    x_imp = der - 2 * mm
    # cabecera con fondo
    c.setFillColorRGB(*_FILL)
    c.setStrokeColorRGB(*_LINE)
    c.setLineWidth(0.6)
    c.rect(M, tab_top - head_h, der - M, head_h, fill=1, stroke=1)
    _set(c, _MUTED)
    c.setFont("Helvetica-Bold", 8)
    ty = tab_top - head_h + 2.3 * mm
    c.drawString(M + 4 * mm, ty, "DESCRIPCIÓN")
    c.drawRightString(x_cant, ty, "CANTIDAD")
    c.drawRightString(x_punit, ty, "P. UNITARIO")
    c.drawRightString(x_imp, ty, "IMPORTE")
    # renglones — si hay detalle persistido, uno por ítem; si no, el renglón único por importe total.
    items = _parse_items(comp.items_json)
    fila0 = tab_top - head_h - 7 * mm
    if items:
        for i, it in enumerate(items):
            fila_y = fila0 - i * 6 * mm
            cant = float(it.get("cantidad") or 0)
            punit = float(it.get("precio_unitario") or 0)
            _set(c, _INK)
            c.setFont("Helvetica", 9.5)
            c.drawString(M + 4 * mm, fila_y, str(it.get("descripcion") or "")[:60])
            c.setFont("Helvetica", 9)
            c.drawRightString(x_cant, fila_y, _cantidad(cant))
            c.drawRightString(x_punit, fila_y, _money(punit))
            c.drawRightString(x_imp, fila_y, _money(round(cant * punit, 2)))
        fila_y = fila0 - (len(items) - 1) * 6 * mm  # y del último renglón (para línea/totales)
    else:
        fila_y = fila0
        _set(c, _INK)
        c.setFont("Helvetica", 9.5)
        c.drawString(M + 4 * mm, fila_y, "Productos y/o servicios")
        c.setFont("Helvetica", 9)
        c.drawRightString(x_cant, fila_y, "1,00")
        c.drawRightString(x_punit, fila_y, _money(comp.imp_total))
        c.drawRightString(x_imp, fila_y, _money(comp.imp_total))
    # línea fina bajo el último renglón
    _set(c, _HAIR)
    c.setStrokeColorRGB(*_HAIR)
    c.setLineWidth(0.5)
    c.line(M, fila_y - 4 * mm, der, fila_y - 4 * mm)

    # ════════════════════════════════════════════════════════════════════════
    # TOTALES — recuadro a la derecha
    # ════════════════════════════════════════════════════════════════════════
    tot_w = 70 * mm
    tot_h = 20 * mm
    tot_x = der - tot_w
    tot_y = fila_y - 8 * mm - tot_h
    c.setFillColorRGB(*_FILL)
    c.setStrokeColorRGB(*_LINE)
    c.setLineWidth(0.6)
    c.rect(tot_x, tot_y, tot_w, tot_h, fill=1, stroke=1)
    # subtotal
    _set(c, _MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(tot_x + 4 * mm, tot_y + tot_h - 7 * mm, "Subtotal")
    _set(c, _INK)
    c.setFont("Helvetica", 9)
    c.drawRightString(tot_x + tot_w - 4 * mm, tot_y + tot_h - 7 * mm, _money(comp.imp_total))
    # separador
    _set(c, _LINE)
    c.setStrokeColorRGB(*_LINE)
    c.setLineWidth(0.5)
    c.line(tot_x + 3 * mm, tot_y + tot_h - 11 * mm, tot_x + tot_w - 3 * mm, tot_y + tot_h - 11 * mm)
    # importe total
    _set(c, _INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(tot_x + 4 * mm, tot_y + 4.5 * mm, "Importe Total")
    c.setFont("Helvetica-Bold", 13)
    c.drawRightString(tot_x + tot_w - 4 * mm, tot_y + 4 * mm, _money(comp.imp_total))

    # ════════════════════════════════════════════════════════════════════════
    # PIE — QR + CAE, separado por una línea
    # ════════════════════════════════════════════════════════════════════════
    pie_y = M + 4 * mm
    sep_y = pie_y + 34 * mm
    _set(c, _LINE)
    c.setStrokeColorRGB(*_LINE)
    c.setLineWidth(0.6)
    c.line(M, sep_y, der, sep_y)

    qr_lado = 30 * mm
    try:
        c.drawImage(
            _qr_imagen(_qr_payload(comp)), M, pie_y, qr_lado, qr_lado,
            preserveAspectRatio=True, mask="auto",
        )
    except Exception:  # noqa: BLE001 — un QR ilegible no debe tumbar la generación del PDF
        pass

    xq = M + qr_lado + 7 * mm
    _set(c, _MUTED)
    c.setFont("Helvetica", 8)
    c.drawString(xq, pie_y + qr_lado - 4 * mm, "Comprobante Autorizado")
    _set(c, _INK)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(xq, pie_y + qr_lado - 12 * mm, f"CAE N.°  {comp.cae}")
    _etiqueta_valor(
        c, xq, pie_y + qr_lado - 18 * mm,
        "Vencimiento del CAE:", _yyyymmdd_a_ddmmyyyy(comp.cae_vto), size=9,
    )
    if comp.cbte_tipo == 13:
        _set(c, _MUTED)
        c.setFont("Helvetica-Oblique", 7.5)
        c.drawString(xq, pie_y + 1 * mm, "Nota de crédito asociada a la factura del mismo punto de venta.")

    c.showPage()
    c.save()
    return buf.getvalue()
