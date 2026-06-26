"""
Representación impresa (PDF) de un comprobante emitido desde la app.

WSFEv1 sólo devuelve el CAE: la representación impresa la genera el emisor (RG 5616 / RG 4291),
con el código QR oficial de ARCA en el pie. Este módulo arma ese PDF a partir del comprobante ya
persistido (`ComprobanteEmitido`) + los datos del emisor (`ClienteARCA`), sin volver a llamar a ARCA.

Sólo aplica a Factura C (11) y Nota de Crédito C (13) de monotributo (clase C, sin IVA discriminado).
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


def _money(v) -> str:
    """1234.5 -> '$ 1.234,50' (formato AR)."""
    s = f"{float(v or 0):,.2f}"  # '1,234.50'
    return "$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


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


def generar(comp: models.ComprobanteEmitido, cliente: models.ClienteARCA) -> bytes:
    """Devuelve el PDF (bytes) de la representación impresa del comprobante."""
    nombre_cbte, letra, codigo = _TIPOS.get(comp.cbte_tipo, ("COMPROBANTE", "C", "000"))
    fiscal = _emisor_fiscal(cliente)
    condicion_emisor = (
        "Responsable Monotributo" if (cliente.regimen or "monotributo") == "monotributo"
        else "Responsable Inscripto"
    )

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    ancho, alto = A4
    izq, der = 15 * mm, ancho - 15 * mm
    medio = ancho / 2

    # ── Encabezado: caja con la letra del comprobante en el centro ──
    top = alto - 18 * mm
    caja_y = top - 18 * mm
    c.setLineWidth(0.8)
    c.rect(izq, caja_y, der - izq, 22 * mm)
    c.line(medio, caja_y, medio, caja_y + 22 * mm)
    # letra centrada en el borde superior
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(medio, caja_y + 11 * mm, letra)
    c.setFont("Helvetica", 7)
    c.drawCentredString(medio, caja_y + 6 * mm, f"COD. {codigo}")

    # Bloque izquierdo: emisor
    c.setFont("Helvetica-Bold", 13)
    c.drawString(izq + 4 * mm, caja_y + 15 * mm, (cliente.nombre or "")[:38])
    c.setFont("Helvetica", 8)
    y = caja_y + 10 * mm
    lineas_emisor = [f"CUIT: {comp.cuit}", condicion_emisor]
    dom = fiscal.get("domicilio")
    if dom:
        loc = ", ".join(x for x in (fiscal.get("localidad"), fiscal.get("provincia")) if x)
        cp = f" (CP {fiscal['cod_postal']})" if fiscal.get("cod_postal") else ""
        lineas_emisor.append(dom + cp)
        if loc:
            lineas_emisor.append(loc)
    for ln in lineas_emisor:
        c.drawString(izq + 4 * mm, y, ln[:48])
        y -= 4 * mm

    # Bloque derecho: tipo + numeración + fecha
    c.setFont("Helvetica-Bold", 14)
    c.drawString(medio + 4 * mm, caja_y + 15 * mm, nombre_cbte)
    c.setFont("Helvetica", 9)
    c.drawString(
        medio + 4 * mm, caja_y + 9 * mm,
        f"Punto de Venta: {comp.punto_venta:05d}    Comp. Nro: {comp.numero:08d}",
    )
    c.drawString(medio + 4 * mm, caja_y + 4 * mm, f"Fecha de Emisión: {_fecha_ddmmyyyy(comp.fecha)}")

    # ── Receptor ──
    rec_y = caja_y - 12 * mm
    c.setLineWidth(0.5)
    c.rect(izq, rec_y, der - izq, 9 * mm)
    c.setFont("Helvetica", 8)
    doc_nro = (comp.doc_nro or "").strip()
    if doc_nro not in ("", "0"):
        receptor = f"CUIT: {doc_nro}"
        cond_rec = "IVA Responsable Inscripto / Monotributo"
    else:
        receptor = "Consumidor Final"
        cond_rec = "IVA Responsable - Consumidor Final"
    c.drawString(izq + 3 * mm, rec_y + 5 * mm, receptor)
    c.drawString(izq + 3 * mm, rec_y + 1.5 * mm, f"Condición frente al IVA: {cond_rec}")

    # ── Detalle (clase C: un único renglón con el importe) ──
    det_top = rec_y - 6 * mm
    c.setFont("Helvetica-Bold", 8)
    c.drawString(izq + 3 * mm, det_top, "Descripción")
    c.drawRightString(der - 3 * mm, det_top, "Importe")
    c.setLineWidth(0.4)
    c.line(izq, det_top - 2 * mm, der, det_top - 2 * mm)
    c.setFont("Helvetica", 9)
    concepto_txt = nombre_cbte.capitalize()
    c.drawString(izq + 3 * mm, det_top - 8 * mm, concepto_txt)
    c.drawRightString(der - 3 * mm, det_top - 8 * mm, _money(comp.imp_total))

    # ── Total ──
    tot_y = det_top - 20 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(der - 30 * mm, tot_y, "Importe Total:")
    c.drawRightString(der - 3 * mm, tot_y, _money(comp.imp_total))

    # ── Pie: QR + CAE ──
    pie_y = 35 * mm
    qr_lado = 28 * mm
    try:
        c.drawImage(_qr_imagen(_qr_payload(comp)), izq, pie_y - 4 * mm, qr_lado, qr_lado)
    except Exception:  # noqa: BLE001 — un QR ilegible no debe tumbar la generación del PDF
        pass
    c.setFont("Helvetica-Bold", 10)
    c.drawString(izq + qr_lado + 6 * mm, pie_y + qr_lado - 8 * mm, f"CAE N°: {comp.cae}")
    c.setFont("Helvetica", 9)
    c.drawString(
        izq + qr_lado + 6 * mm, pie_y + qr_lado - 14 * mm,
        f"Vencimiento del CAE: {_yyyymmdd_a_ddmmyyyy(comp.cae_vto)}",
    )

    c.showPage()
    c.save()
    return buf.getvalue()
