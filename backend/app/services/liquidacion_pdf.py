"""Parseo del PDF de una Liquidación Electrónica del sector primario (agro).

La grilla de liquidaciones (afip.py::lsp_consultar) NO trae el importe; sale del PDF
(afip.py::lsp_pdf). Estos PDF son de plantilla FIJA de AFIP (los genera lsp-web), así
que una sola regla sirve para todos los sectores/tipos. El dato que interesa para la
facturación/topes de monotributo es el **Importe Bruto** (la venta bruta), NO el Neto
(que ya tiene descontados gastos/retenciones; Bruto ≠ Neto cuando hay gastos).

CUIDADO: en el text-stream del PDF el número sale SEPARADO de su etiqueta (layout
posicionado), así que un `Importe Bruto:\\s*\\$\\s*(...)` naive falla. Se parsea por
COORDENADAS: se ancla en las palabras "Importe"+"Bruto" y se toma el número alineado a
su misma fila (mismo `top`), a la derecha. Regex sobre layout como respaldo.
"""
from __future__ import annotations

import io
import re

import pdfplumber

_RE_NUM = re.compile(r"^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?$|^\d+(?:[.,]\d{1,2})?$")


def _a_float(txt: str) -> float | None:
    """'5,748,575.00' o '5.748.575,00' -> 5748575.0. El separador decimal es el ÚLTIMO
    punto/coma con 1-2 dígitos detrás; el resto son miles."""
    s = (txt or "").strip().replace("$", "").replace(" ", "")
    if not s:
        return None
    m = re.search(r"[.,](\d{1,2})$", s)
    if m:
        entero = re.sub(r"[.,]", "", s[: m.start()])
        return float(f"{entero}.{m.group(1)}")
    return float(re.sub(r"[.,]", "", s)) if s.replace(".", "").replace(",", "").isdigit() else None


def _por_coordenadas(palabras: list[dict], etiqueta: tuple[str, str]) -> float | None:
    """Busca las palabras `etiqueta` (p.ej. ('Importe','Bruto')) y devuelve el número de
    su misma fila (mismo top ± tolerancia) más a la derecha de la etiqueta."""
    e0, e1 = etiqueta
    for i, w in enumerate(palabras):
        if w["text"] == e0 and i + 1 < len(palabras) and palabras[i + 1]["text"].startswith(e1):
            top = w["top"]
            x_der = palabras[i + 1]["x1"]
            cand = [
                p for p in palabras
                if abs(p["top"] - top) < 4 and p["x0"] > x_der and _RE_NUM.match(p["text"])
            ]
            if cand:
                cand.sort(key=lambda p: p["x0"])
                return _a_float(cand[-1]["text"])
    return None


def importe_bruto(pdf_bytes: bytes) -> float | None:
    """Importe Bruto de la liquidación (en pesos), o None si no se pudo leer.

    Las 3 copias (Original/Duplicado/Triplicado) son idénticas: alcanza la 1ª página.
    """
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[0]
        palabras = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        bruto = _por_coordenadas(palabras, ("Importe", "Bruto"))
        if bruto is not None:
            return bruto
        # Respaldo: layout preserva la fila "Importe Bruto: $   5.748.575,00".
        texto = page.extract_text(layout=True) or ""
    m = re.search(r"Importe\s+Bruto\s*:?\s*\$?\s*([\d.,]+)", texto)
    return _a_float(m.group(1)) if m else None
