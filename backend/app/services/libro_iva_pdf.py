"""PDF del Libro IVA (Ventas o Compras) de un período, al estilo del libro que imprimen los sistemas
de escritorio (Nacional Sistema): un renglón por comprobante y alícuota, con no gravado, exento,
percepciones separadas por tipo y total; al pie los totales, el resumen por alícuota y el de
percepciones. Lo piden los contadores para controlar contra el Portal IVA y para archivar.

Recibe los comprobantes YA con las correcciones aplicadas (`iva_correcciones.efectivos`): los
corregidos van marcados con * y los excluidos se listan aparte, sin sumar."""
from __future__ import annotations

import datetime as dt
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

from ..schemas import TIPO_COMPROBANTE, TIPOS_NOTA_CREDITO
from . import iva_correcciones

_INK = colors.Color(0.13, 0.14, 0.17)
_MUTED = colors.Color(0.42, 0.44, 0.49)
_LINE = colors.Color(0.74, 0.76, 0.80)
_HAIR = colors.Color(0.86, 0.88, 0.91)
_FILL = colors.Color(0.955, 0.96, 0.97)

_MARGEN = 10 * mm
_FONT = 6.6


def _num(v: float) -> str:
    """1234.5 -> '1.234,50'; 0 -> '' (celdas vacías como en el libro impreso)."""
    if abs(v) < 0.005:
        return ""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _num0(v: float) -> str:
    """Como _num pero muestra 0,00 (para totales)."""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _cuit(c: str) -> str:
    d = "".join(ch for ch in (c or "") if ch.isdigit())
    return f"{d[:2]}-{d[2:10]}-{d[10:]}" if len(d) == 11 else (c or "")


def _abrev(cbte_tipo: int) -> str:
    """'Nota Crédito A' -> 'NC A', 'Factura FCE B' -> 'FCE B', 'Tique Factura A' -> 'TF A'."""
    nombre = TIPO_COMPROBANTE.get(cbte_tipo, f"Tipo {cbte_tipo}")
    letra = nombre.split()[-1] if nombre.split()[-1] in ("A", "B", "C", "M", "E") else ""
    base = nombre[: -len(letra)].strip() if letra else nombre
    tabla = {
        "Factura": "FC", "Nota Débito": "ND", "Nota Crédito": "NC", "Recibo": "RC",
        "Factura FCE": "FCE", "Nota Débito FCE": "NDE", "Nota Crédito FCE": "NCE",
        "Tique Factura": "TF", "Tique": "TQ", "Tique Nota Crédito": "TNC", "Tique Nota Débito": "TND",
    }
    return f"{tabla.get(base, base[:4])} {letra}".strip()


def _alic(a: float) -> str:
    return f"{a:g}%".replace(".", ",")


def _trunc(texto: str, n: int) -> str:
    texto = texto or ""
    return texto if len(texto) <= n else texto[: n - 1] + "…"


class _CanvasNumerado(rl_canvas.Canvas):
    """Canvas que conoce el total de hojas para imprimir 'Hoja X de Y' (patrón de reportlab)."""

    def __init__(self, *args, encabezado=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._paginas = []
        self._encabezado = encabezado

    def showPage(self):  # noqa: N802 — API de reportlab
        self._paginas.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._paginas)
        for estado in self._paginas:
            self.__dict__.update(estado)
            self._encabezado(self, total)
            super().showPage()
        super().save()


def generar(
    comps: list,
    *,
    cliente_nombre: str,
    cuit: str,
    periodo_label: str,
    direccion: str,
    por_alicuota: list,
) -> bytes:
    """PDF del Libro IVA del período. `comps` = comprobantes efectivos (con correcciones), incluidos
    los excluidos (se listan aparte). `por_alicuota` = subtotales por alícuota ya neteados."""
    es_ventas = direccion == "ventas"
    titulo = "LIBRO IVA VENTAS" if es_ventas else "LIBRO IVA COMPRAS"
    contraparte = "Cliente" if es_ventas else "Proveedor"
    emitido = dt.date.today().strftime("%d/%m/%Y")
    ancho_pag, alto_pag = landscape(A4)

    def encabezado(c: rl_canvas.Canvas, total_paginas: int) -> None:
        c.saveState()
        y = alto_pag - _MARGEN
        c.setFillColor(_INK)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(_MARGEN, y - 4 * mm, titulo)
        c.setFont("Helvetica", 8.5)
        c.drawString(_MARGEN, y - 9 * mm, f"{cliente_nombre}  ·  CUIT {_cuit(cuit)}")
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(ancho_pag - _MARGEN, y - 4 * mm, f"Período: {periodo_label}")
        c.setFont("Helvetica", 8)
        c.setFillColor(_MUTED)
        c.drawRightString(
            ancho_pag - _MARGEN, y - 9 * mm, f"Hoja {c.getPageNumber()} de {total_paginas}"
        )
        c.setStrokeColor(_LINE)
        c.setLineWidth(0.6)
        c.line(_MARGEN, y - 11.5 * mm, ancho_pag - _MARGEN, y - 11.5 * mm)
        c.setFont("Helvetica", 6.5)
        c.drawString(_MARGEN, _MARGEN - 4 * mm, f"Emitido el {emitido} · Órbita Contadores")
        c.restoreState()

    # --- tabla principal -----------------------------------------------------------------------
    cab = [
        "Fecha", "Comprobante", contraparte, "CUIT", "Alíc.", "Neto gravado", "IVA",
        "No gravado", "Exento", "Perc. IVA", "Perc. IIBB", "Imp. int.", "Otros trib.", "Total",
    ]
    anchos_mm = [14, 31, 46, 20, 10, 21, 18, 16, 16, 16, 16, 15, 15, 23]
    filas: list[list[str]] = [cab]
    estilos: list[tuple] = []
    tot = dict(neto=0.0, iva=0.0, nog=0.0, exe=0.0, piva=0.0, piibb=0.0, pint=0.0, potros=0.0, total=0.0)
    hubo_corregidos = hubo_sin_desglose = False
    excluidos = [c for c in comps if c.excluido]

    for c in comps:
        if c.excluido:
            continue
        signo = -1.0 if c.cbte_tipo in TIPOS_NOTA_CREDITO else 1.0
        sin_desglose = c.imp_neto is None and c.imp_iva is None
        hubo_sin_desglose = hubo_sin_desglose or sin_desglose
        total = float(c.imp_total or 0)
        nog = 0.0 if sin_desglose else float(c.imp_no_gravado or 0)
        exe = 0.0 if sin_desglose else float(c.imp_exento or 0)
        p = iva_correcciones.percepciones_de(c)
        p_otros = p["muni"] + p["otros_nac"] + p["otros"] + p["no_categ"]
        alics = iva_correcciones.alicuotas_de(c)
        if not alics:
            neto = total if sin_desglose else float(c.imp_neto or 0)
            iva = 0.0 if sin_desglose else float(c.imp_iva or 0)
            alics = [{"alicuota": None, "base": neto, "iva": iva}] if (neto or iva) else [
                {"alicuota": None, "base": 0.0, "iva": 0.0}
            ]
        marca = " *" if c.corregido else ""
        hubo_corregidos = hubo_corregidos or c.corregido
        comp_txt = (
            f"{_abrev(c.cbte_tipo)} {str(c.punto_venta).zfill(5)}-{str(c.numero).zfill(8)}{marca}"
        )
        inicio = len(filas)
        for i, a in enumerate(alics):
            base = signo * float(a["base"] or 0)
            iva = signo * float(a["iva"] or 0)
            tot["neto"] += base
            tot["iva"] += iva
            alic_txt = _alic(float(a["alicuota"])) if a["alicuota"] is not None else ""
            if i == 0:
                filas.append([
                    c.fecha.strftime("%d/%m/%Y"),
                    comp_txt,
                    _trunc(c.contraparte_nombre or "—", 30),
                    _cuit(c.doc_nro),
                    alic_txt,
                    _num(base),
                    _num(iva),
                    _num(signo * nog),
                    _num(signo * exe),
                    _num(signo * p["iva"]),
                    _num(signo * p["iibb"]),
                    _num(signo * p["internos"]),
                    _num(signo * p_otros),
                    _num0(signo * total),
                ])
            else:
                filas.append(["", "", "", "", alic_txt, _num(base), _num(iva), "", "", "", "", "", "", ""])
        tot["nog"] += signo * nog
        tot["exe"] += signo * exe
        tot["piva"] += signo * p["iva"]
        tot["piibb"] += signo * p["iibb"]
        tot["pint"] += signo * p["internos"]
        tot["potros"] += signo * p_otros
        tot["total"] += signo * total
        if signo < 0:
            estilos.append(("TEXTCOLOR", (0, inicio), (-1, len(filas) - 1), colors.Color(0.70, 0.15, 0.15)))
        # línea fina debajo de cada comprobante (agrupa sus renglones de alícuota)
        estilos.append(("LINEBELOW", (0, len(filas) - 1), (-1, len(filas) - 1), 0.25, _HAIR))

    cant = len(comps) - len(excluidos)
    filas.append([
        f"{cant} comprobante{'s' if cant != 1 else ''}", "", "", "", "TOTAL",
        _num0(tot["neto"]), _num0(tot["iva"]), _num0(tot["nog"]), _num0(tot["exe"]),
        _num0(tot["piva"]), _num0(tot["piibb"]), _num0(tot["pint"]), _num0(tot["potros"]),
        _num0(tot["total"]),
    ])

    tabla = Table(filas, colWidths=[w * mm for w in anchos_mm], repeatRows=1)
    tabla.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", _FONT),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", _FONT),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", _FONT),
        ("TEXTCOLOR", (0, 0), (-1, -1), _INK),
        ("BACKGROUND", (0, 0), (-1, 0), _FILL),
        ("BACKGROUND", (0, -1), (-1, -1), _FILL),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, _LINE),
        ("LINEABOVE", (0, -1), (-1, -1), 0.6, _LINE),
        ("ALIGN", (4, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        *estilos,
    ]))

    # --- resúmenes -----------------------------------------------------------------------------
    st_tit = ParagraphStyle("tit", fontName="Helvetica-Bold", fontSize=8.5, textColor=_INK, spaceAfter=3)
    st_nota = ParagraphStyle("nota", fontName="Helvetica", fontSize=7, textColor=_MUTED, leading=9)

    def _tabla_resumen(cab_r: list[str], filas_r: list[list[str]], anchos: list[float]) -> Table:
        t = Table([cab_r, *filas_r], colWidths=[w * mm for w in anchos])
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 7.2),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.2),
            ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 7.2),
            ("TEXTCOLOR", (0, 0), (-1, -1), _INK),
            ("BACKGROUND", (0, 0), (-1, 0), _FILL),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, _LINE),
            ("LINEABOVE", (0, -1), (-1, -1), 0.6, _LINE),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8),
        ]))
        return t

    lado_iva = "Débito fiscal" if es_ventas else "Crédito fiscal"
    filas_alic = [[a.alicuota.replace(".", ","), _num0(a.neto), _num0(a.iva)] for a in por_alicuota]
    if abs(tot["exe"]) >= 0.005:
        filas_alic.append(["Exento", _num0(tot["exe"]), ""])
    if abs(tot["nog"]) >= 0.005:
        filas_alic.append(["No gravado", _num0(tot["nog"]), ""])
    filas_alic.append(["Total", _num0(sum(a.neto for a in por_alicuota) + tot["exe"] + tot["nog"]),
                       _num0(sum(a.iva for a in por_alicuota))])
    t_alic = _tabla_resumen(["Alícuota", "Neto", lado_iva], filas_alic, [24, 30, 30])

    filas_perc = [
        ["Percepciones de IVA", _num0(tot["piva"])],
        ["Percepciones de Ingresos Brutos", _num0(tot["piibb"])],
        ["Impuestos internos", _num0(tot["pint"])],
        ["Otros tributos (municipales y otros)", _num0(tot["potros"])],
        ["Total", _num0(tot["piva"] + tot["piibb"] + tot["pint"] + tot["potros"])],
    ]
    t_perc = _tabla_resumen(["Concepto", "Importe"], filas_perc, [55, 30])

    resumen = Table(
        [[Paragraph("Resumen por alícuota", st_tit), "", Paragraph("Percepciones y otros tributos", st_tit)],
         [t_alic, "", t_perc]],
        colWidths=[86 * mm, 12 * mm, 87 * mm],
    )
    resumen.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    resumen.hAlign = "LEFT"

    historia: list = [tabla, Spacer(1, 6 * mm), resumen]

    notas = []
    if hubo_corregidos:
        notas.append("* Comprobante corregido por el estudio (alícuota, letra o percepciones).")
    if hubo_sin_desglose:
        notas.append("Los comprobantes sin IVA discriminado se informan con el total como neto.")
    if notas:
        historia += [Spacer(1, 4 * mm), *[Paragraph(n, st_nota) for n in notas]]

    if excluidos:
        historia += [
            Spacer(1, 5 * mm),
            Paragraph(
                f"Comprobantes excluidos del libro ({len(excluidos)}) — no corresponden a la actividad",
                st_tit,
            ),
        ]
        filas_ex = [["Fecha", "Comprobante", contraparte, "CUIT", "Total", "Motivo"]]
        for c in excluidos:
            filas_ex.append([
                c.fecha.strftime("%d/%m/%Y"),
                f"{_abrev(c.cbte_tipo)} {str(c.punto_venta).zfill(5)}-{str(c.numero).zfill(8)}",
                _trunc(c.contraparte_nombre or "—", 34),
                _cuit(c.doc_nro),
                _num0(float(c.imp_total or 0)),
                _trunc(c.nota or "", 60),
            ])
        t_ex = Table(filas_ex, colWidths=[w * mm for w in (16, 32, 55, 22, 24, 80)], repeatRows=1)
        t_ex.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", _FONT),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", _FONT),
            ("TEXTCOLOR", (0, 0), (-1, -1), _MUTED),
            ("BACKGROUND", (0, 0), (-1, 0), _FILL),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, _LINE),
            ("ALIGN", (4, 0), (4, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
        ]))
        t_ex.hAlign = "LEFT"
        historia.append(t_ex)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=_MARGEN,
        rightMargin=_MARGEN,
        topMargin=_MARGEN + 14 * mm,
        bottomMargin=_MARGEN,
        title=f"{titulo.title()} {periodo_label} - {cliente_nombre}",
        author="Órbita Contadores",
    )
    doc.build(historia, canvasmaker=lambda *a, **k: _CanvasNumerado(*a, encabezado=encabezado, **k))
    return buf.getvalue()
