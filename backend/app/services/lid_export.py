"""Generador de los archivos del Libro IVA Digital de AFIP (VENTAS y COMPRAS: cabecera + alícuotas).

Formato de ANCHO FIJO leído de Nacional Sistema (ver memoria `lid-formato-afip`): fechas YYYYMMDD;
importes = valor×100 (2 decimales implícitos), 15 chars, zero-pad izquierda, sin signo ni separador;
enteros zero-pad izquierda; texto left-justified con space-pad y truncado al largo. Cada archivo es
una línea por registro terminada en salto de línea.

Órbita ya tiene la data: la cabecera sale de las columnas del comprobante (imp_neto/iva/exento/
no_gravado/trib/total) y las alícuotas de `alicuotas_json` (una fila por alícuota, con su base/IVA/ID).
"""
from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal

from .. import models
from ..schemas import TIPO_COMPROBANTE, TIPOS_MONOTRIBUTO

# ID de alícuota de AFIP por tasa (%). Confirmado en Nacional: 0→3, 2.5→9, 5→8, 10.5→4, 21→5, 27→6.
_ALICUOTA_ID = {0.0: 3, 2.5: 9, 5.0: 8, 10.5: 4, 21.0: 5, 27.0: 6}


def _letra(cbte_tipo: int) -> str:
    """Letra de clase del comprobante (A/B/C/M/E) a partir del nombre del tipo. '' si no se deduce."""
    for token in reversed(TIPO_COMPROBANTE.get(cbte_tipo, "").split()):
        if token in ("A", "B", "C", "M", "E"):
            return token
    return "C" if cbte_tipo in TIPOS_MONOTRIBUTO else ""

# Moneda: AFIP usa 'PES' (pesos), 'DOL' (dólar). El resto se pasa tal cual (3 chars).
_MONEDA_AFIP = {"ARS": "PES", "PES": "PES", "USD": "DOL"}


def _ent(valor: int | float | None, largo: int) -> str:
    """Entero zero-pad a la izquierda."""
    return str(int(valor or 0)).zfill(largo)[:largo]


def _imp(valor: float | None, largo: int = 15) -> str:
    """Importe: valor×100 (2 decimales implícitos), zero-pad. Redondeo bancario a 2 decimales primero.
    Siempre en valor absoluto (las notas de crédito van como tipo de comprobante propio, sin signo)."""
    cent = Decimal(str(abs(valor or 0))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100
    return str(int(cent)).zfill(largo)[:largo]


def _txt(valor: str | None, largo: int) -> str:
    """Texto left-justified, space-pad a la derecha, truncado al largo."""
    return (valor or "").ljust(largo)[:largo]


def _cambio(cot: float | None) -> str:
    """Tipo de cambio: 10 chars, 6 decimales implícitos (valor×1e6), zero-pad."""
    v = Decimal(str(cot or 1)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP) * 1_000_000
    return str(int(v)).zfill(10)[:10]


def _es_clase_c(cbte_tipo: int) -> bool:
    return cbte_tipo in TIPOS_MONOTRIBUTO


def _cod_doc(doc_nro: str) -> tuple[int, str]:
    """(código de documento AFIP, número) del comprador a partir del doc guardado. 80=CUIT (11
    dígitos), 96=DNI (7-8), 99=Consumidor Final (vacío/0)."""
    d = "".join(ch for ch in (doc_nro or "") if ch.isdigit())
    if len(d) == 11:
        return 80, d
    if 7 <= len(d) <= 8:
        return 96, d
    return 99, d or "0"


def _percepciones(c: models.ComprobanteEmitido) -> dict | None:
    """Desglose de percepciones por tipo (del import del borrador de AFIP), o None si no se importó."""
    if not c.percepciones_json:
        return None
    try:
        return json.loads(c.percepciones_json)
    except ValueError:
        return None


def _percep_o_fallback(c: models.ComprobanteEmitido) -> dict:
    """Percepciones por tipo para el export. Si se importó el borrador de AFIP, usa el desglose real;
    si no, mete el total lumpeado (imp_trib) en 'otros' y el resto en 0 (no sobre-declara percep IVA)."""
    campos = ("iva", "iibb", "muni", "internos", "otros_nac", "otros", "no_categ")
    p = _percepciones(c)
    if p:
        return {k: float(p.get(k) or 0) for k in campos}
    return {k: (float(c.imp_trib or 0) if k == "otros" else 0.0) for k in campos}


def _alicuotas_de(c: models.ComprobanteEmitido) -> list[dict]:
    """Lista de alícuotas del comprobante (de alicuotas_json). [] si no tiene / no discrimina."""
    if not c.alicuotas_json:
        return []
    try:
        return json.loads(c.alicuotas_json) or []
    except ValueError:
        return []


def _cant_alicuotas(c: models.ComprobanteEmitido, alics: list[dict], *, sin_b: bool = False) -> int:
    """Cantidad de alícuotas (campo 190 del LID). Clase C → 0 (y en COMPRAS también clase B, `sin_b`).
    Sin IVA pero con exento/no gravado → 1 (fila con alícuota id 3). Si no, la cantidad real."""
    if _es_clase_c(c.cbte_tipo) or (sin_b and _letra(c.cbte_tipo) == "B"):
        return 0
    iva = float(c.imp_iva or 0)
    exento = float(c.imp_exento or 0)
    no_grav = float(c.imp_no_gravado or 0)
    if iva == 0 and (exento != 0 or no_grav != 0):
        return 1
    return len(alics)


def _fila_cabecera(c: models.ComprobanteEmitido) -> str:
    alics = _alicuotas_de(c)
    cod_doc, num_doc = _cod_doc(c.doc_nro)
    es_c = _es_clase_c(c.cbte_tipo)
    cant = _cant_alicuotas(c, alics)
    iva = float(c.imp_iva or 0)
    exento = float(c.imp_exento or 0)
    no_grav = float(c.imp_no_gravado or 0)
    cod_op = "E" if (iva == 0 and (exento != 0 or no_grav != 0)) else " "
    pv = _percep_o_fallback(c)
    campos = [
        c.fecha.strftime("%Y%m%d"),                                   # 10 Fecha (8)
        _ent(c.cbte_tipo, 3),                                         # 20 Tipo cbte (3)
        _ent(c.punto_venta, 5),                                       # 30 Punto de venta (5)
        _ent(c.numero, 20),                                           # 40 Número (20)
        _ent(c.numero, 20),                                           # 50 Número hasta (20)
        _ent(cod_doc, 2),                                             # 60 Cód doc comprador (2)
        _ent(num_doc, 20),                                            # 70 N° doc comprador (20)
        _txt(c.contraparte_nombre, 30),                              # 80 Razón social (30)
        _imp(float(c.imp_total)),                                     # 90 Importe total (15)
        _imp(0 if es_c else no_grav),                                 # 100 No gravado (15)
        _imp(pv["no_categ"]),                                         # 110 Percep no categorizado (15)
        _imp(exento),                                                 # 120 Exento (15)
        # Percepciones: si se importó el borrador de AFIP, separadas por tipo (en ventas el campo 130
        # combina percep IVA + otras nacionales); si no, el total lumpeado va a "Otros Tributos" (210).
        _imp(pv["iva"] + pv["otros_nac"]),                            # 130 Percep IVA+Nacionales (15)
        _imp(pv["iibb"]),                                             # 140 Percep IIBB (15)
        _imp(pv["muni"]),                                             # 150 Percep Municipales (15)
        _imp(pv["internos"]),                                         # 160 Impuestos Internos (15)
        _txt(_MONEDA_AFIP.get(c.moneda or "ARS", c.moneda or "PES"), 3),  # 170 Moneda (3)
        _cambio(float(c.cotizacion) if c.cotizacion is not None else 1),  # 180 Tipo de cambio (10)
        _ent(cant, 1),                                               # 190 Cantidad de alícuotas (1)
        _txt(cod_op, 1),                                             # 200 Código de operación (1)
        _imp(pv["otros"]),                                            # 210 Otros tributos (15)
        "00000000",                                                  # 220 Fecha vto pago (8)
    ]
    return "".join(campos)


def _filas_alicuota(c: models.ComprobanteEmitido) -> list[str]:
    """Filas del archivo de alícuotas para un comprobante (una por alícuota). Para el caso exento/no
    gravado sin IVA (cant=1) emite una fila con alícuota id 3 y base/impuesto 0."""
    alics = _alicuotas_de(c)
    cab = _ent(c.cbte_tipo, 3) + _ent(c.punto_venta, 5) + _ent(c.numero, 20)
    if alics:
        filas = []
        for a in alics:
            aid = _ALICUOTA_ID.get(float(a["alicuota"]), 3)
            filas.append(cab + _imp(float(a["base"])) + _ent(aid, 4) + _imp(float(a["iva"])))
        return filas
    if _cant_alicuotas(c, alics) == 1:  # exento / no gravado sin IVA discriminado
        return [cab + _imp(0) + _ent(3, 4) + _imp(0)]
    return []


def generar_lid_ventas(comps: list[models.ComprobanteEmitido]) -> dict[str, str]:
    """Genera los TXT del Libro IVA Digital de VENTAS. Devuelve {nombre_logico: contenido}:
    'cabecera' (LID_VENTAS) y 'alicuotas' (LID_VENTAS_ALICUOTA). Ordenados por fecha/PV/número."""
    ordenados = sorted(comps, key=lambda c: (c.fecha, c.punto_venta, c.numero))
    cabecera = "\r\n".join(_fila_cabecera(c) for c in ordenados)
    filas_alic: list[str] = []
    for c in ordenados:
        filas_alic.extend(_filas_alicuota(c))
    alicuotas = "\r\n".join(filas_alic)
    return {
        "cabecera": (cabecera + "\r\n") if cabecera else "",
        "alicuotas": (alicuotas + "\r\n") if alicuotas else "",
    }


# --- COMPRAS (recibidos) -------------------------------------------------------
# Difiere de ventas: cabecera con despacho de importación (vacío), doc del VENDEDOR, crédito fiscal
# computable (=IVA), y separa la percepción de IVA (campo 120). El proveedor siempre es CUIT (80).
def _fila_cabecera_compras(c: models.ComprobanteEmitido) -> str:
    alics = _alicuotas_de(c)
    _, num_doc = _cod_doc(c.doc_nro)  # doc del vendedor (proveedor); AFIP/Nacional lo tratan como CUIT
    letra = _letra(c.cbte_tipo)
    sin_credito = letra in ("C", "B")
    cant = _cant_alicuotas(c, alics, sin_b=True)
    iva = float(c.imp_iva or 0)
    exento = float(c.imp_exento or 0)
    no_grav = float(c.imp_no_gravado or 0)
    cod_op = "E" if (iva == 0 and (exento != 0 or no_grav != 0)) else " "
    p = _percep_o_fallback(c)
    campos = [
        c.fecha.strftime("%Y%m%d"),                                   # 10 Fecha (8)
        _ent(c.cbte_tipo, 3),                                         # 20 Tipo cbte (3)
        _ent(c.punto_venta, 5),                                       # 30 Punto de venta (5)
        _ent(c.numero, 20),                                           # 40 Número (20)
        _txt("", 16),                                                 # 50 Despacho importación (16)
        _ent(80, 2),                                                  # 60 Cód doc vendedor (2) = CUIT
        _ent(num_doc, 20),                                           # 70 N° doc vendedor (20)
        _txt(c.contraparte_nombre, 30),                              # 80 Razón social vendedor (30)
        _imp(float(c.imp_total)),                                     # 90 Importe total (15)
        _imp(0 if sin_credito else no_grav),                          # 100 No gravado (15)
        _imp(exento),                                                 # 110 Exento (15)
        # Percepciones: si se importó el borrador de AFIP, van separadas por tipo; si no, todo el total
        # lumpeado (imp_trib) va a "Otros Tributos" (220) para NO sobre-declarar percepción IVA.
        _imp(p["iva"]),                                               # 120 Percepciones IVA (15)
        _imp(p["otros_nac"]),                                         # 130 Percep otros nacionales (15)
        _imp(p["iibb"]),                                              # 140 Percep IIBB (15)
        _imp(p["muni"]),                                              # 150 Percep Municipales (15)
        _imp(p["internos"]),                                          # 160 Impuestos Internos (15)
        _txt(_MONEDA_AFIP.get(c.moneda or "ARS", c.moneda or "PES"), 3),  # 170 Moneda (3)
        _cambio(float(c.cotizacion) if c.cotizacion is not None else 1),  # 180 Tipo de cambio (10)
        _ent(cant, 1),                                               # 190 Cantidad de alícuotas (1)
        _txt(cod_op, 1),                                             # 200 Código de operación (1)
        _imp(0 if sin_credito else iva),                              # 210 Crédito fiscal computable (15)
        _imp(p["otros"]),                                             # 220 Otros tributos (15)
        _ent(0, 11),                                                 # 230 CUIT emisor/corredor (11)
        _txt("", 30),                                                # 240 Denominación emisor (30)
        _imp(0),                                                      # 250 IVA comisión (15)
    ]
    return "".join(campos)


def _filas_alicuota_compras(c: models.ComprobanteEmitido) -> list[str]:
    """Filas del archivo de alícuotas de compras (incluye el doc del vendedor). Una por alícuota."""
    alics = _alicuotas_de(c)
    _, num_doc = _cod_doc(c.doc_nro)
    cab = (
        _ent(c.cbte_tipo, 3) + _ent(c.punto_venta, 5) + _ent(c.numero, 20)
        + _ent(80, 2) + _ent(num_doc, 20)
    )
    if alics:
        return [
            cab + _imp(float(a["base"])) + _ent(_ALICUOTA_ID.get(float(a["alicuota"]), 3), 4)
            + _imp(float(a["iva"]))
            for a in alics
        ]
    if _cant_alicuotas(c, alics, sin_b=True) == 1:  # exento / no gravado sin IVA
        return [cab + _imp(0) + _ent(3, 4) + _imp(0)]
    return []


def generar_lid_compras(comps: list[models.ComprobanteEmitido]) -> dict[str, str]:
    """Genera los TXT del Libro IVA Digital de COMPRAS (cabecera LID_COMPRAS + alícuotas
    LID_COMPRAS_ALICUOTA). Ordenados por fecha/PV/número."""
    ordenados = sorted(comps, key=lambda c: (c.fecha, c.punto_venta, c.numero))
    cabecera = "\r\n".join(_fila_cabecera_compras(c) for c in ordenados)
    filas_alic: list[str] = []
    for c in ordenados:
        filas_alic.extend(_filas_alicuota_compras(c))
    alicuotas = "\r\n".join(filas_alic)
    return {
        "cabecera": (cabecera + "\r\n") if cabecera else "",
        "alicuotas": (alicuotas + "\r\n") if alicuotas else "",
    }
