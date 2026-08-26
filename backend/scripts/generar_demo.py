"""
generar_demo.py — arma (o rehace) una CUENTA DE DEMOSTRACIÓN con una cartera de ejemplo.

Sirve para mostrar Órbita sin datos de nadie: contribuyentes inventados, con nombres y CUIT que no
corresponden a ninguna persona real, y una historia de facturación coherente de 14 meses. La cuenta
queda marcada `Usuario.demo`, así el motor continuo no la toca, no le escribe a los contactos de
ejemplo y las consultas en vivo de la ficha responden con lo que ya está cargado (ver
`app/services/demo.py`).

    cd backend
    .venv\\Scripts\\python -m scripts.generar_demo --password "loQueSea123"
    .venv\\Scripts\\python -m scripts.generar_demo --borrar        # limpia la cartera y la cuenta

Es IDEMPOTENTE: correrlo de nuevo rehace la cartera desde cero (borra los clientes de ejemplo y sus
datos, y los vuelve a generar). La cartera se genera con semilla fija, así dos corridas dan lo mismo.
Todo lo que se ve —facturación, deuda, categorías, alertas— sale de estos datos, no de un mock del
front: el sistema los procesa igual que a los reales.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import random

from sqlalchemy import delete, select

from app import models
from app.crypto import cifrar
from app.db import Base, SessionLocal, asegurar_columnas, engine
from app.security import hashear_password
from app.services import categorias_afip
from app.services import conciliacion as conciliacion_svc
from app.services import contabilidad as contabilidad_svc

# --- Constantes de la demo -------------------------------------------------------------------

EMAIL_DEFAULT = "derben@infogestion.com.ar"
SEMILLA = 26082026  # cartera reproducible: misma semilla, misma historia

# Los CUIT de ejemplo se arman con documento en el rango 99.xxx.xxx, que no está asignado a nadie
# (los DNI reales van muy por debajo). El dígito verificador SÍ se calcula bien: la app valida CUIT
# en varios lados y un número mal formado no pasaría.
DOC_BASE = 99_100_000

# Escala del monotributo. Es el FALLBACK: al arrancar, `cargar_categorias_oficiales()` la pisa con
# los montos vigentes que publica el organismo —la misma fuente que usa la app para mostrar el tope
# de cada cliente—. Sin eso la cartera quedaría calibrada contra topes viejos y media cartera
# aparecería como "debería recategorizarse" apenas el contador abre el panel.
CATEGORIAS: dict[str, dict] = {
    "A": {"tope": 10_277_988, "servicios": 42_387, "comercio": 42_387},
    "B": {"tope": 15_058_448, "servicios": 48_251, "comercio": 48_251},
    "C": {"tope": 21_113_697, "servicios": 56_502, "comercio": 55_227},
    "D": {"tope": 26_212_853, "servicios": 72_414, "comercio": 70_661},
    "E": {"tope": 30_833_964, "servicios": 102_538, "comercio": 92_658},
    "F": {"tope": 38_642_048, "servicios": 129_045, "comercio": 111_198},
    "G": {"tope": 46_211_109, "servicios": 197_108, "comercio": 135_918},
    "H": {"tope": 70_113_407, "servicios": 447_347, "comercio": 272_063},
    "I": {"tope": 78_479_212, "servicios": 824_802, "comercio": 406_512},
    "J": {"tope": 89_872_640, "servicios": 999_008, "comercio": 497_059},
    "K": {"tope": 108_357_084, "servicios": 1_381_688, "comercio": 600_880},
}

# Códigos de comprobante de ARCA usados por la cartera de ejemplo.
FACTURA_A, NC_A, FACTURA_B, NC_B, FACTURA_C, NC_C = 1, 3, 6, 8, 11, 13

# Actividades declaradas (código y descripción del nomenclador, tal como figuran en la constancia).
ACTIVIDADES = {
    "consultoria": ("620100", "Servicios de consultores en informática y suministros de programas"),
    "diseno": ("741000", "Servicios de diseño especializado"),
    "contable": ("692000", "Servicios de contabilidad, auditoría y asesoría fiscal"),
    "salud": ("862200", "Servicios de consulta médica y odontológica"),
    "kiosco": ("471130", "Venta al por menor en kioscos, polirrubros y comercios no especializados"),
    "indumentaria": ("477110", "Venta al por menor de ropa y accesorios de vestir"),
    "ferreteria": ("475210", "Venta al por menor de artículos de ferretería y materiales eléctricos"),
    "gastronomia": ("561011", "Servicios de restaurantes y cantinas sin espectáculo"),
    "fletes": ("492180", "Servicio de transporte automotor de cargas"),
    "peluqueria": ("960201", "Servicios de peluquería"),
    "construccion": ("433000", "Terminación y acabado de edificios"),
    "psicologia": ("869090", "Servicios de atención de la salud humana n.c.p."),
    "clases": ("854910", "Servicios de enseñanza de idiomas y de apoyo escolar"),
    "fotografia": ("742000", "Servicios de fotografía"),
    "marketing": ("731001", "Servicios de publicidad y estudios de mercado"),
    "verduleria": ("472111", "Venta al por menor de frutas y verduras"),
    "libreria": ("476910", "Venta al por menor de artículos de librería y papelería"),
    "taller": ("452100", "Servicios de reparación y mantenimiento de vehículos"),
    "granja": ("011110", "Cultivo de cereales y oleaginosas"),
    "software": ("620200", "Servicios de consultoría en informática y desarrollo a medida"),
    "distribucion": ("463099", "Venta al por mayor de productos alimenticios n.c.p."),
    "metalurgica": ("259999", "Fabricación de productos elaborados de metal n.c.p."),
    "inmobiliaria": ("681010", "Servicios de alquiler de inmuebles propios"),
    "logistica": ("522010", "Servicios de manipulación y depósito de mercaderías"),
}

# Sistemas de facturación con los que se habilita un punto de venta (como los nombra el organismo).
SISTEMAS_PV = ["Factura en línea - Monotributo", "R.E.C.E. - Factura electrónica", "Web Services"]

# Contrapartes de ejemplo: a quién le factura y de quién compra la cartera. Todas inventadas.
EMPRESAS = [
    ("30991000015", "ESTUDIO CONTABLE DEL SUR SRL"),
    ("30991000023", "DISTRIBUIDORA SAN JAVIER SA"),
    ("30991000031", "TECNOLOGIA APLICADA DEL LITORAL SRL"),
    ("30991000040", "COOPERATIVA DE TRABAJO LA MERCED LTDA"),
    ("30991000058", "CONSTRUCCIONES MEDITERRANEO SA"),
    ("30991000066", "ALIMENTOS DEL VALLE SRL"),
    ("30991000074", "TRANSPORTES RIO CUARTO SA"),
    ("30991000082", "SERVICIOS INTEGRALES PAMPEANOS SRL"),
    ("30991000090", "EDITORIAL CAMPOS VERDES SA"),
    ("30991000104", "INDUSTRIAS METALICAS ALVEAR SRL"),
]
PROVEEDORES = [
    ("30991000112", "MAYORISTA CENTRAL DE INSUMOS SA"),
    ("30991000120", "PAPELERA DEL PLATA SRL"),
    ("30991000139", "ENERGIA Y SERVICIOS DEL ESTE SA"),
    ("30991000147", "TELECOMUNICACIONES UNIFICADAS SRL"),
    ("30991000155", "LOGISTICA Y CARGAS DEL CENTRO SA"),
    ("30991000163", "INSUMOS INFORMATICOS ARGENTINOS SRL"),
    ("30991000171", "SEGUROS LA PROVIDENTE SA"),
    ("30991000180", "INMOBILIARIA TORRES Y ASOCIADOS SRL"),
]

LOCALIDADES = [
    "AV. RIVADAVIA 4520 PISO 3 DTO B - CIUDAD AUTONOMA BUENOS AIRES",
    "SAN MARTIN 1245 - ROSARIO, SANTA FE",
    "BELGRANO 780 - CORDOBA, CORDOBA",
    "MITRE 355 PISO 2 - LA PLATA, BUENOS AIRES",
    "9 DE JULIO 1120 - MENDOZA, MENDOZA",
    "ALVEAR 640 - MAR DEL PLATA, BUENOS AIRES",
    "SARMIENTO 2210 - SANTA FE, SANTA FE",
    "ENTRE RIOS 480 - BAHIA BLANCA, BUENOS AIRES",
]


# --- Utilidades ------------------------------------------------------------------------------


def cargar_categorias_oficiales() -> str:
    """Actualiza CATEGORIAS con la escala vigente. Devuelve una línea para el log."""
    try:
        oficiales = categorias_afip.montos_categorias()
    except Exception:  # noqa: BLE001 — sin conexión a la tabla pública: seguimos con el fallback
        oficiales = None
    if not oficiales:
        return "Escala del monotributo: se usa la tabla de referencia del script (sin actualizar)."
    for c in oficiales:
        if c.codigo in CATEGORIAS:
            CATEGORIAS[c.codigo] = {
                "tope": float(c.topeAnual),
                "servicios": float(c.cuotaServicios),
                "comercio": float(c.cuotaComercio),
            }
    return f"Escala del monotributo: vigente (tope Cat. A ${CATEGORIAS['A']['tope']:,.0f})."


def digito_verificador(base: str) -> str:
    """DV de un CUIT (los 10 primeros dígitos), algoritmo módulo 11 de ARCA."""
    pesos = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    suma = sum(int(d) * p for d, p in zip(base, pesos))
    resto = 11 - (suma % 11)
    if resto == 11:
        return "0"
    if resto == 10:
        return "9"
    return str(resto)


def armar_cuit(prefijo: str, doc: int) -> str:
    base = f"{prefijo}{doc:08d}"
    return base + digito_verificador(base)


def primer_dia(anio: int, mes: int) -> dt.date:
    return dt.date(anio, mes, 1)


def sumar_meses(fecha: dt.date, meses: int) -> dt.date:
    """Corre `meses` (positivo o negativo) sobre el primer día del mes de `fecha`."""
    idx = fecha.year * 12 + (fecha.month - 1) + meses
    return dt.date(idx // 12, idx % 12 + 1, 1)


def inicio_ventana_12m(hoy: dt.date) -> dt.date:
    """Igual criterio que routers/clientes._inicio_ventana_12m: los 12 meses calendario que
    terminan este mes. Lo que caiga acá adentro es el 'facturado 12 meses' del cliente."""
    return sumar_meses(primer_dia(hoy.year, hoy.month), -11)


def redondear(x: float) -> float:
    """Importes con dos decimales, como los devuelve el organismo."""
    return round(x + 0.0, 2)


# --- La cartera de ejemplo -------------------------------------------------------------------
# Cada fila es un contribuyente inventado. `pct` es cuánto factura en los últimos 12 meses medido
# contra el tope de SU categoría: de ahí salen solas las alertas, porque el sistema las deriva del
# dato como con un cliente real. Ojo con la calibración —es lo que hace que el panel se lea—: la
# banda de cada categoría arranca donde termina la anterior (D empieza en el 80% de su propio tope,
# E en el 85%), así que un monotributista bien encuadrado en D o E SIEMPRE figura "cerca del tope".
# Por eso los clientes en orden viven en A, B, C y H (bandas anchas, hasta ~76% sin alerta) y las
# categorías altas quedan para los casos que sí queremos mostrar en amarillo. `anual` reemplaza a
# `pct` en los responsables inscriptos, que no tienen categoría ni tope.
CARTERA: list[dict] = [
    # --- Para resolver ya (rojo) --------------------------------------------------------------
    {"nombre": "BENITEZ SOFIA ELENA", "sexo": "f", "cat": "F", "act": "comercio",
     "rubro": "indumentaria", "pct": 1.06, "pv": [1, 2]},
    {"nombre": "CABRERA HORACIO DANIEL", "sexo": "m", "cat": "B", "act": "servicios",
     "rubro": "fletes", "pct": 1.42, "pv": [1]},
    {"nombre": "LEDESMA MARTIN EZEQUIEL", "sexo": "m", "cat": "C", "act": "servicios",
     "rubro": "software", "pct": 1.18, "pv": [1], "recat_abierta": True},
    {"nombre": "FERREYRA NATALIA SOLEDAD", "sexo": "f", "cat": "A", "act": "servicios",
     "rubro": "peluqueria", "pct": 0.49, "pv": [1], "cuota": "con-deuda", "meses_adeudados": 9},
    # --- Para mirar esta semana (amarillo) ----------------------------------------------------
    {"nombre": "ALVAREZ MARIANO GABRIEL", "sexo": "m", "cat": "D", "act": "servicios",
     "rubro": "consultoria", "pct": 0.87, "pv": [1]},
    {"nombre": "IBARRA GUSTAVO JAVIER", "sexo": "m", "cat": "D", "act": "comercio",
     "rubro": "kiosco", "pct": 0.92, "pv": [1], "debito": True},
    {"nombre": "TORRES ALEJANDRO RUBEN", "sexo": "m", "cat": "G", "act": "servicios",
     "rubro": "construccion", "pct": 0.90, "pv": [1, 2], "debito": True},
    {"nombre": "DOMINGUEZ LAURA BEATRIZ", "sexo": "f", "cat": "H", "act": "servicios",
     "rubro": "contable", "pct": 0.26, "pv": [1]},
    {"nombre": "ESPINDOLA RAMON ALBERTO", "sexo": "m", "cat": "C", "act": "comercio",
     "rubro": "ferreteria", "pct": 0.74, "pv": [1, 3], "cuota": "con-deuda", "meses_adeudados": 1},
    {"nombre": "JUAREZ CECILIA MARIANA", "sexo": "f", "cat": "H", "act": "servicios",
     "rubro": "marketing", "pct": 0.71, "pv": [1, 2], "dfe": 2},
    {"nombre": "PEREYRA DIEGO SEBASTIAN", "sexo": "m", "cat": "C", "act": "comercio",
     "rubro": "distribucion", "pct": 0.74, "pv": [1, 4], "dfe": 1},
    # --- En orden (verde) ---------------------------------------------------------------------
    {"nombre": "GIMENEZ PABLO ANDRES", "sexo": "m", "cat": "C", "act": "servicios",
     "rubro": "salud", "pct": 0.73, "pv": [1], "saldo_favor": 84_320.55},
    {"nombre": "HERRERA VALERIA INES", "sexo": "f", "cat": "B", "act": "servicios",
     "rubro": "psicologia", "pct": 0.71, "pv": [1], "rel_dep": True},
    {"nombre": "NUÑEZ FEDERICO ARIEL", "sexo": "m", "cat": "H", "act": "comercio",
     "rubro": "gastronomia", "pct": 0.69, "pv": [1, 2]},
    {"nombre": "OLIVERA MARIA JOSE", "sexo": "f", "cat": "C", "act": "servicios",
     "rubro": "diseno", "pct": 0.75, "pv": [1]},
    {"nombre": "QUIROGA ANALIA VERONICA", "sexo": "f", "cat": "B", "act": "servicios",
     "rubro": "clases", "pct": 0.70, "pv": [1]},
    {"nombre": "ROMERO LUCAS EMANUEL", "sexo": "m", "cat": "A", "act": "servicios",
     "rubro": "fotografia", "pct": 0.64, "pv": [1]},
    {"nombre": "SOSA CLAUDIA NOEMI", "sexo": "f", "cat": "A", "act": "comercio",
     "rubro": "verduleria", "pct": 0.52, "pv": [1], "sin_avisos": True},
    {"nombre": "URQUIZA MARCELA FABIANA", "sexo": "f", "cat": "C", "act": "servicios",
     "rubro": "contable", "pct": 0.73, "pv": [1]},
    {"nombre": "VARELA NESTOR EDUARDO", "sexo": "m", "cat": "B", "act": "comercio",
     "rubro": "taller", "pct": 0.72, "pv": [1]},
    {"nombre": "ZALAZAR PATRICIA LORENA", "sexo": "f", "cat": "A", "act": "servicios",
     "rubro": "peluqueria", "pct": 0.38, "pv": [1]},
    {"nombre": "ACOSTA JULIAN NICOLAS", "sexo": "m", "cat": "H", "act": "servicios",
     "rubro": "software", "pct": 0.72, "pv": [1, 2], "debito": True},
    {"nombre": "BARRIOS SILVANA MARISOL", "sexo": "f", "cat": "B", "act": "comercio",
     "rubro": "indumentaria", "pct": 0.71, "pv": [1]},
    {"nombre": "CORONEL WALTER OSCAR", "sexo": "m", "cat": "A", "act": "servicios",
     "rubro": "granja", "pct": 0.58, "pv": [1], "sin_avisos": True},
    {"nombre": "MALDONADO ROCIO AYELEN", "sexo": "f", "cat": "A", "act": "comercio",
     "rubro": "libreria", "pct": 0.0, "pv": [], "alta_reciente": True},
    # --- Responsables inscriptos --------------------------------------------------------------
    {"nombre": "NAVARRO SERGIO OMAR", "sexo": "m", "regimen": "responsable_inscripto",
     "rubro": "consultoria", "anual": 96_400_000, "pv": [1, 2]},
    {"nombre": "OJEDA MARIA FERNANDA", "sexo": "f", "regimen": "responsable_inscripto",
     "rubro": "inmobiliaria", "anual": 71_800_000, "pv": [1]},
    {"nombre": "AGROSERVICIOS LOS ALAMOS SRL", "sociedad": True,
     "regimen": "responsable_inscripto", "rubro": "granja", "anual": 318_500_000, "pv": [1, 2],
     "dfe": 1},
    {"nombre": "TALLERES INDUSTRIALES ZARATE SA", "sociedad": True,
     "regimen": "responsable_inscripto", "rubro": "metalurgica", "anual": 452_900_000,
     "pv": [1, 3, 5]},
    {"nombre": "SOFTWARE FACTORY DEL NORTE SRL", "sociedad": True,
     "regimen": "responsable_inscripto", "rubro": "software", "anual": 187_300_000, "pv": [1]},
]


# --- Generación de la historia de facturación ------------------------------------------------

MESES_HISTORIA = 14  # 12 de la ventana del facturado + 2 anteriores, para que el histórico respire


def pesos_mensuales(rng: random.Random, hoy: dt.date, estacional: str) -> list[float]:
    """Peso relativo de cada uno de los `MESES_HISTORIA` meses. Combina tres cosas que hacen que la
    curva se lea como la de un contribuyente real y no como una línea recta: crecimiento sostenido
    (los importes de hace un año son más chicos), estacionalidad del rubro y ruido mes a mes. El mes
    en curso se prorratea por los días transcurridos: recién empezado, factura menos."""
    pesos: list[float] = []
    for i in range(MESES_HISTORIA):
        mes = sumar_meses(primer_dia(hoy.year, hoy.month), i - (MESES_HISTORIA - 1))
        base = 1.028 ** i  # crecimiento mensual sostenido
        if estacional == "comercio":
            factor = {12: 1.45, 1: 0.72, 2: 0.80, 7: 1.12}.get(mes.month, 1.0)
        else:
            factor = {1: 0.66, 2: 0.85, 12: 1.10, 7: 0.92}.get(mes.month, 1.0)
        peso = base * factor * rng.uniform(0.86, 1.14)
        if i == MESES_HISTORIA - 1:  # mes en curso: sólo lo facturado hasta hoy
            dias_mes = (sumar_meses(mes, 1) - mes).days
            peso *= max(hoy.day - 1, 1) / dias_mes
        pesos.append(peso)
    return pesos


def repartir(rng: random.Random, total: float, n: int) -> list[float]:
    """Parte `total` en `n` importes desparejos que suman exactamente `total`."""
    if n <= 0 or total <= 0:
        return []
    crudos = [rng.uniform(0.45, 1.75) for _ in range(n)]
    escala = total / sum(crudos)
    montos = [redondear(c * escala) for c in crudos]
    montos[-1] = redondear(total - sum(montos[:-1]))  # el último absorbe el redondeo
    return montos


def dia_habil(rng: random.Random, mes: dt.date, hoy: dt.date) -> dt.date:
    """Una fecha del mes, de lunes a sábado, sin pasarse de hoy."""
    ultimo = (sumar_meses(mes, 1) - dt.timedelta(days=1)).day
    tope = min(ultimo, hoy.day - 1) if (mes.year, mes.month) == (hoy.year, hoy.month) else ultimo
    tope = max(tope, 1)
    for _ in range(12):
        d = mes.replace(day=rng.randint(1, tope))
        if d.weekday() != 6:  # los domingos casi no se factura
            return d
    return mes.replace(day=tope)


def desglose_iva(total: float) -> dict:
    """Neto e IVA de un comprobante con IVA discriminado (21%), como los devuelve el organismo."""
    neto = redondear(total / 1.21)
    iva = redondear(total - neto)
    return {
        "imp_neto": neto,
        "imp_iva": iva,
        "imp_no_gravado": 0.0,
        "imp_exento": 0.0,
        "imp_trib": 0.0,
        "alicuotas_json": json.dumps([{"alicuota": 21.0, "base": neto, "iva": iva}]),
    }


def generar_movimientos(rng: random.Random, cfg: dict, cuit: str, hoy: dt.date) -> list[dict]:
    """Toda la facturación del cliente: lo que emitió (con sus notas de crédito) y lo que recibió de
    sus proveedores, mes a mes. Devuelve filas listas para ComprobanteEmitido."""
    es_ri = cfg.get("regimen") == "responsable_inscripto"
    objetivo = cfg["anual"] if es_ri else CATEGORIAS[cfg["cat"]]["tope"] * cfg["pct"]
    if objetivo <= 0:
        return []

    pesos = pesos_mensuales(rng, hoy, cfg.get("act", "servicios"))
    # La escala se calcula SOBRE LA VENTANA de 12 meses: así el facturado que ve el contador es
    # exactamente el que pide el perfil (y con él, el % del tope y la categoría que corresponde).
    escala = objetivo / sum(pesos[MESES_HISTORIA - 12:])
    totales = [p * escala for p in pesos]

    puntos = cfg.get("pv") or [1]
    # Numeración correlativa por punto de venta y tipo, arrancando en un número verosímil.
    numeros: dict[tuple[int, int], int] = {}

    def siguiente(pv: int, tipo: int) -> int:
        clave = (pv, tipo)
        if clave not in numeros:
            numeros[clave] = rng.randint(120, 2600)
        numeros[clave] += 1
        return numeros[clave]

    if es_ri:
        tipo_factura, tipo_nc = FACTURA_A, NC_A
        por_mes = (14, 34)
        ratio_compras = (0.42, 0.63)
    elif cfg.get("act") == "comercio":
        tipo_factura, tipo_nc = FACTURA_C, NC_C
        por_mes = (11, 26)
        ratio_compras = (0.38, 0.58)
    else:
        tipo_factura, tipo_nc = FACTURA_C, NC_C
        por_mes = (3, 9)
        ratio_compras = (0.16, 0.34)

    filas: list[dict] = []
    for i, total_mes in enumerate(totales):
        mes = sumar_meses(primer_dia(hoy.year, hoy.month), i - (MESES_HISTORIA - 1))
        if total_mes <= 0:
            continue
        # Nota de crédito ocasional: se emite de más y se descuenta, para que el neto del mes sea el
        # que corresponde (es lo que hace el sistema al netear el histórico).
        ratio_nc = rng.uniform(0.04, 0.13) if rng.random() < 0.3 else 0.0
        bruto = total_mes * (1 + ratio_nc)
        n = rng.randint(*por_mes)
        for monto in repartir(rng, bruto, n):
            if monto <= 0:
                continue
            pv = rng.choice(puntos)
            # A quién le factura: los comercios venden mostrador (consumidor final), los servicios
            # trabajan más con empresas.
            a_empresa = rng.random() < (0.25 if cfg.get("act") == "comercio" else 0.62)
            if es_ri and tipo_factura == FACTURA_A:
                a_empresa = True  # la factura A se le emite a un responsable inscripto
            doc, nombre = rng.choice(EMPRESAS) if a_empresa else ("", "CONSUMIDOR FINAL")
            fila = {
                "cuit": cuit, "direccion": "emitido", "cbte_tipo": tipo_factura,
                "punto_venta": pv, "numero": siguiente(pv, tipo_factura),
                "fecha": dia_habil(rng, mes, hoy), "imp_total": redondear(monto),
                "doc_nro": doc, "contraparte_nombre": nombre,
                "condicion_iva_receptor": 1 if a_empresa else 5,
            }
            if es_ri:
                fila.update(desglose_iva(monto))
            filas.append(fila)
        if ratio_nc:
            monto_nc = redondear(total_mes * ratio_nc)
            pv = rng.choice(puntos)
            doc, nombre = rng.choice(EMPRESAS)
            fila = {
                "cuit": cuit, "direccion": "emitido", "cbte_tipo": tipo_nc,
                "punto_venta": pv, "numero": siguiente(pv, tipo_nc),
                "fecha": dia_habil(rng, mes, hoy), "imp_total": monto_nc,
                "doc_nro": doc, "contraparte_nombre": nombre, "condicion_iva_receptor": 1,
            }
            if es_ri:
                fila.update(desglose_iva(monto_nc))
            filas.append(fila)

        # Compras del mes (lo que le facturaron a él): alquiler, insumos, servicios.
        compras = total_mes * rng.uniform(*ratio_compras)
        for monto in repartir(rng, compras, rng.randint(*((6, 14) if es_ri else (2, 6)))):
            if monto <= 0:
                continue
            doc, nombre = rng.choice(PROVEEDORES)
            tipo = FACTURA_A if es_ri else rng.choice([FACTURA_A, FACTURA_B])
            fila = {
                "cuit": cuit, "direccion": "recibido", "cbte_tipo": tipo,
                "punto_venta": rng.randint(1, 9), "numero": rng.randint(1000, 99000),
                "fecha": dia_habil(rng, mes, hoy), "imp_total": redondear(monto),
                "doc_nro": doc, "contraparte_nombre": nombre, "condicion_iva_receptor": 1,
            }
            if tipo == FACTURA_A:  # sólo la factura A trae el IVA discriminado
                fila.update(desglose_iva(monto))
            filas.append(fila)
    return filas


# --- Datos de padrón, cuota y estado de cuenta -----------------------------------------------


def vencimiento_cuota(hoy: dt.date) -> dt.date:
    """Próximo vencimiento de la cuota: el 20 de cada mes, corrido al lunes si cae fin de semana."""
    mes = primer_dia(hoy.year, hoy.month)
    if hoy.day > 20:
        mes = sumar_meses(mes, 1)
    d = mes.replace(day=20)
    if d.weekday() == 5:
        d += dt.timedelta(days=2)
    elif d.weekday() == 6:
        d += dt.timedelta(days=1)
    return d


def ventana_recategorizacion(hoy: dt.date) -> tuple[str, str, str]:
    """Ventana semestral vigente a futuro (apertura / cierre / cómo se muestra). La recategorización
    cierra el 5 de febrero y el 5 de agosto; el organismo la abre unas semanas antes."""
    candidatas = [dt.date(hoy.year, 2, 5), dt.date(hoy.year, 8, 5), dt.date(hoy.year + 1, 2, 5)]
    cierre = next((c for c in candidatas if c >= hoy), dt.date(hoy.year + 1, 8, 5))
    apertura = sumar_meses(primer_dia(cierre.year, cierre.month), -1).replace(day=15)
    return apertura.isoformat(), cierre.isoformat(), cierre.strftime("%d/%m/%Y")


def estado_de_cuenta(rng: random.Random, cfg: dict, hoy: dt.date, cuota: float) -> dict:
    """Detalle de la cuenta corriente del contribuyente: el saldo de cada período y los movimientos
    que lo explican. Es lo que se ve en la solapa Estado de cuenta."""
    meses_deuda = cfg.get("meses_adeudados", 0)
    saldo_favor = cfg.get("saldo_favor", 0.0)
    saldos: list[dict] = []
    movimientos: list[dict] = []
    capital = 0.0
    for i in range(max(meses_deuda + 2, 6)):
        mes = sumar_meses(primer_dia(hoy.year, hoy.month), -i - 1)
        impago = i < meses_deuda
        importe = redondear(cuota * (0.94 ** i))  # la cuota de meses anteriores era más barata
        saldos.append({
            "periodo": mes.strftime("%Y-%m"),
            "saldo": redondear(-importe) if impago else 0.0,
            "tipo": "MONOTRIBUTO",
            "estado": "DEUDOR" if impago else "SALDADO",
        })
        if impago:
            capital += importe
            movimientos.append({
                "periodo": mes.strftime("%Y-%m"), "impuesto": "MONOTRIBUTO",
                "concepto": "Obligación mensual",
                "descripcion": "Impuesto integrado y cotizaciones previsionales",
                "vencimiento": mes.replace(day=20).strftime("%d/%m/%Y"),
                "debe": importe, "haber": 0.0,
            })
    intereses = redondear(capital * 0.021 * max(meses_deuda, 1)) if capital else 0.0
    if intereses:
        movimientos.append({
            "periodo": saldos[0]["periodo"], "impuesto": "MONOTRIBUTO", "concepto": "Accesorios",
            "descripcion": "Intereses resarcitorios", "vencimiento": hoy.strftime("%d/%m/%Y"),
            "debe": intereses, "haber": 0.0,
        })
    return {
        "fecha_calculo": hoy.isoformat(),
        "periodo_desde": saldos[-1]["periodo"], "periodo_hasta": saldos[0]["periodo"],
        "deudor": redondear(capital + intereses), "acreedor": redondear(saldo_favor),
        "capital": redondear(capital), "intereses": intereses,
        "movimientos": movimientos, "por_periodo": [],
        "saldos_periodo": list(reversed(saldos)),
    }


ASUNTOS_DFE = [
    ("Intimación por falta de presentación de declaración jurada",
     "Se comunica que, según los registros del organismo, no consta presentada la declaración jurada "
     "correspondiente al período indicado. Se otorga un plazo de 15 días corridos para regularizar la "
     "situación o formular el descargo que corresponda."),
    ("Aviso de vencimiento de la Clave Fiscal",
     "Le informamos que su Clave Fiscal está próxima a vencer. Deberá renovarla para continuar "
     "operando con normalidad en los servicios que la requieren."),
    ("Notificación de recategorización",
     "Se pone en su conocimiento que, según los parámetros informados, corresponde revisar su "
     "encuadramiento en el Régimen Simplificado. El detalle puede consultarse en el servicio "
     "Monotributo."),
    ("Constancia de presentación de declaración jurada",
     "Se acusa recibo de la declaración jurada presentada. El presente aviso constituye constancia de "
     "su recepción."),
    ("Puesta a disposición de información de terceros",
     "Se pone a su disposición la información suministrada por terceros correspondiente al período "
     "fiscal informado, a los fines de su verificación."),
]


def comunicaciones_de(rng: random.Random, cfg: dict, cuit: str, hoy: dt.date) -> list[dict]:
    """Comunicaciones del Domicilio Fiscal Electrónico: varias viejas (ya leídas) y, para algunos
    clientes, las nuevas sin ver que encienden el punto rojo de la ficha."""
    filas: list[dict] = []
    for _ in range(rng.randint(1, 4)):
        asunto, detalle = rng.choice(ASUNTOS_DFE)
        pub = hoy - dt.timedelta(days=rng.randint(60, 400))
        filas.append({
            "id_comunicacion": f"{cuit[-6:]}{rng.randint(100000, 999999)}",
            "fecha_publicacion": dt.datetime.combine(pub, dt.time(rng.randint(8, 18), rng.randint(0, 59))),
            "asunto": asunto, "prioridad": rng.choice(["Normal", "Alta"]), "detalle": detalle,
            "leida_arca": True, "vista_por_contador": True, "nueva": False,
        })
    for i in range(cfg.get("dfe", 0)):
        asunto, detalle = ASUNTOS_DFE[i % len(ASUNTOS_DFE)]
        pub = hoy - dt.timedelta(days=rng.randint(1, 9))
        filas.append({
            "id_comunicacion": f"{cuit[-6:]}{rng.randint(100000, 999999)}",
            "fecha_publicacion": dt.datetime.combine(pub, dt.time(rng.randint(8, 18), rng.randint(0, 59))),
            "asunto": asunto, "prioridad": "Alta", "detalle": detalle,
            "leida_arca": False, "vista_por_contador": False, "nueva": True,
        })
    return filas


def movimientos_banco(rng: random.Random, emitidos: list[dict], hoy: dt.date) -> list[dict]:
    """Un extracto de los últimos dos meses: los cobros de varias facturas (que la conciliación va a
    cruzar sola), algún ingreso que no es de la actividad y los pagos del período."""
    desde = sumar_meses(primer_dia(hoy.year, hoy.month), -1)
    ventas = [
        c for c in emitidos
        if c["direccion"] == "emitido" and c["fecha"] >= desde
        and c["cbte_tipo"] in (FACTURA_A, FACTURA_B, FACTURA_C)
    ]
    rng.shuffle(ventas)
    filas: list[dict] = []
    for comp in ventas[:14]:
        cobro = comp["fecha"] + dt.timedelta(days=rng.randint(0, 6))
        if cobro >= hoy:
            continue
        filas.append({
            "fecha": cobro, "monto": comp["imp_total"], "tipo": "credito",
            "fuente": rng.choice(["banco", "mercadopago"]),
            "cuit_originante": comp["doc_nro"] or None,
            "nombre_originante": comp["contraparte_nombre"] if comp["doc_nro"] else None,
            "descripcion": "TRANSFERENCIA RECIBIDA" if comp["doc_nro"] else "COBRO CON QR",
        })
    for _ in range(rng.randint(1, 3)):  # ingresos que no son de la actividad
        filas.append({
            "fecha": desde + dt.timedelta(days=rng.randint(0, 45)),
            "monto": redondear(rng.uniform(50_000, 900_000)), "tipo": "credito", "fuente": "banco",
            "cuit_originante": None, "nombre_originante": None,
            "descripcion": rng.choice(["ACREDITACION VARIOS", "DEVOLUCION DE FONDOS",
                                       "TRANSFERENCIA RECIBIDA"]),
        })
    for _ in range(rng.randint(3, 8)):  # pagos: la conciliación no los cruza, la contabilidad sí los usa
        filas.append({
            "fecha": desde + dt.timedelta(days=rng.randint(0, 45)),
            "monto": redondear(rng.uniform(20_000, 700_000)), "tipo": "debito", "fuente": "banco",
            "cuit_originante": None, "nombre_originante": None,
            "descripcion": rng.choice(["PAGO DE SERVICIOS", "DEBITO AUTOMATICO",
                                       "TRANSFERENCIA ENVIADA", "COMPRA CON TARJETA DE DEBITO",
                                       "EXTRACCION POR CAJERO"]),
        })
    return filas


# --- Armado en la base -----------------------------------------------------------------------


def ahora() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def hash_dedup(cuit: str, fecha: dt.date, monto: float, desc: str | None, orig: str | None) -> str:
    """Mismo hash que usa la importación de extractos (services/conciliacion._hash): así, si el
    contador vuelve a subir el mismo extracto, no se duplica."""
    crudo = f"{cuit}|{fecha.isoformat()}|{monto:.2f}|{desc or ''}|{orig or ''}"
    return hashlib.sha1(crudo.encode("utf-8")).hexdigest()  # noqa: S324 — dedup, no es seguridad


def cuit_de(idx: int, cfg: dict) -> str:
    """CUIT de ejemplo del cliente: prefijo según persona/sociedad y documento del tramo no asignado."""
    if cfg.get("sociedad"):
        prefijo = "30"
    else:
        prefijo = "27" if cfg.get("sexo") == "f" else "20"
    return armar_cuit(prefijo, DOC_BASE + idx * 137)


def contacto_de(cfg: dict, rng: random.Random) -> tuple[str, str]:
    """Mail y teléfono de contacto del cliente. El dominio `example.com` está reservado justamente
    para ejemplos: aunque alguien active los recordatorios, no hay ninguna casilla real detrás."""
    partes = cfg["nombre"].lower().split()
    if cfg.get("sociedad"):
        mail = f"administracion.{partes[0][:14]}@example.com"
    else:
        # En el padrón el nombre viene como APELLIDO NOMBRES: el contacto se arma al revés.
        nombre_pila = partes[1] if len(partes) > 1 else partes[0]
        mail = f"{nombre_pila}.{partes[0]}@example.com"
    tel = f"11 5{rng.randint(100, 999)}-{rng.randint(1000, 9999)}"
    return mail, tel


def limpiar_cartera(db, usuario_id: int) -> int:
    """Borra la cartera de ejemplo y TODO lo que cuelga de ella, hijos primero (en Postgres las
    claves foráneas no perdonan). Devuelve cuántos clientes se borraron."""
    cuits = list(db.scalars(
        select(models.ClienteARCA.cuit).where(models.ClienteARCA.usuario_id == usuario_id)
    ))
    if not cuits:
        return 0
    asientos = list(db.scalars(
        select(models.AsientoManual.id).where(models.AsientoManual.cuit.in_(cuits))
    ))
    if asientos:
        db.execute(delete(models.LineaAsientoManual).where(
            models.LineaAsientoManual.asiento_id.in_(asientos)
        ))
    for modelo in (
        models.AsientoManual, models.ImputacionComprobante, models.ReglaImputacion,
        models.CierreContable, models.EventoContable, models.CuentaContable, models.IvaAjuste,
        models.MovimientoBancario, models.ComunicacionDFE, models.LiquidacionAgro,
        models.ComprobanteEmitido, models.Extraccion,
    ):
        db.execute(delete(modelo).where(modelo.cuit.in_(cuits)))
    db.execute(delete(models.AlertaEnviada).where(models.AlertaEnviada.usuario_id == usuario_id))
    db.execute(delete(models.ClienteARCA).where(models.ClienteARCA.cuit.in_(cuits)))
    db.execute(delete(models.CredencialARCA).where(models.CredencialARCA.cuit.in_(cuits)))
    db.commit()
    return len(cuits)


def asegurar_usuario(db, email: str, password: str, nombre: str, apellido: str, estudio: str):
    """Crea (o actualiza) la cuenta de demostración y le deja el plan completo, así el profesor ve
    todos los apartados del producto."""
    usuario = db.scalar(select(models.Usuario).where(models.Usuario.email == email))
    if usuario is None:
        usuario = models.Usuario(email=email, cuit=armar_cuit("20", DOC_BASE - 1))
        db.add(usuario)
    usuario.nombre = nombre
    usuario.apellido = apellido
    usuario.telefono = "11 5555-0000"
    usuario.dni = str(DOC_BASE - 1)
    usuario.estudio = estudio
    usuario.matricula = "T° 1 F° 1"
    usuario.rol = "contador"
    usuario.activo = True
    usuario.demo = True
    usuario.acepto_terminos = True
    usuario.email_confirmado = True  # sin banner de "confirmá tu correo" en la demo
    usuario.aviso_alertas_pendiente = 0
    # Config del estudio. Los criterios de alertas quedan en los valores por defecto (así se ve el
    # producto como viene); lo único que se fija es la proyección de facturación en 2% mensual en
    # vez de seguir el índice del mercado, para que el semáforo no cambie de color de un día para
    # otro porque cambió una expectativa de inflación. Los envíos automáticos, apagados: los
    # contactos de la cartera son de ejemplo.
    usuario.config_json = json.dumps({
        "inflacionAuto": False,
        "inflacionMensualProyeccion": 0.02,
        "vencimientos": {"activo": False},
        "notificaciones": {"activo": False, "horaDesde": 9, "horaHasta": 21},
    }, ensure_ascii=False)
    if password:
        usuario.password_hash = hashear_password(password)
    db.flush()

    suscripcion = db.scalar(
        select(models.Suscripcion).where(models.Suscripcion.usuario_id == usuario.id)
    )
    if suscripcion is None:
        suscripcion = models.Suscripcion(usuario_id=usuario.id)
        db.add(suscripcion)
    hoy = dt.date.today()
    suscripcion.plan = "completo"
    suscripcion.estado = "sin_cargo"  # cuenta de muestra: no vence ni pide pagos
    suscripcion.ciclo = "mensual"
    suscripcion.precio = 0
    suscripcion.inicio = hoy.isoformat()
    suscripcion.vence = None
    suscripcion.notas = "Cuenta de demostración (cartera de ejemplo). No facturar."
    db.commit()
    return usuario


def sembrar_cliente(db, usuario, idx: int, cfg: dict, hoy: dt.date) -> dict:
    """Da de alta un contribuyente de ejemplo con toda su historia. Devuelve un resumen para el log."""
    rng = random.Random(SEMILLA + idx * 977)
    cuit = cuit_de(idx, cfg)
    es_ri = cfg.get("regimen") == "responsable_inscripto"
    rubro = ACTIVIDADES[cfg["rubro"]]
    mail, tel = contacto_de(cfg, rng)

    # La clave fiscal del cliente: en la demo no abre nada, pero la columna es obligatoria y así la
    # ficha se comporta igual que con un cliente real. El flush va acá a propósito: el cliente
    # apunta a la credencial por clave foránea y Postgres la exige YA escrita (SQLite no chista, así
    # que sin esto anda en desarrollo y revienta en producción).
    if db.get(models.CredencialARCA, cuit) is None:
        db.add(models.CredencialARCA(cuit=cuit, clave_cifrada=cifrar(b"demo-sin-uso")))
        db.flush()

    movimientos = generar_movimientos(rng, cfg, cuit, hoy)
    desde12 = inicio_ventana_12m(hoy)
    facturado12 = sum(
        m["imp_total"] * (-1 if m["cbte_tipo"] in (NC_A, NC_B, NC_C) else 1)
        for m in movimientos
        if m["direccion"] == "emitido" and m["fecha"] >= desde12
    )

    cliente = models.ClienteARCA(
        cuit=cuit,
        nombre=cfg["nombre"],
        cuit_credencial=cuit,
        usuario_id=usuario.id,
        # Lo que guarda el padrón: 'monotributo' o 'no_monotributo'. Que un cliente sea responsable
        # inscripto lo resuelve el sistema al ver que emite comprobantes clase A (resolver_regimen),
        # igual que con un cliente real.
        regimen="no_monotributo" if es_ri else "monotributo",
        email_cliente=mail,
        telefono_cliente=tel,
        # El recordatorio queda habilitado en la ficha (así la pantalla de Vencimientos muestra a
        # quién le llegaría y por cuánto), salvo en un par donde se ve la exclusión manual. Que NO
        # salga ningún correo lo garantiza la cuenta: es demo, y el pase mensual la saltea entera
        # (services/demo.py). El interruptor del estudio además viene apagado.
        venc_avisos=False if cfg.get("sin_avisos") else None,
        email_cliente_origen="padron",
        emails_padron_json=json.dumps([mail]),
        actividades_json=json.dumps([
            {"codigo": rubro[0], "descripcion": rubro[1],
             "periodo": f"{rng.randint(2012, 2024)}-{rng.randint(1, 12):02d}"}
        ]),
        emisor_fiscal_json=json.dumps({
            "razon_social": cfg["nombre"], "domicilio": rng.choice(LOCALIDADES),
            "inicio_actividades": f"01/{rng.randint(1, 12):02d}/{rng.randint(2012, 2024)}",
        }),
        puntos_venta_json=json.dumps([
            {"nro": nro, "nombre_fantasia": "", "sistema_desc": rng.choice(SISTEMAS_PV),
             "domicilio": rng.choice(LOCALIDADES), "baja": False}
            for nro in (cfg.get("pv") or [])
        ]),
        pv_chequeado_en=ahora() - dt.timedelta(days=rng.randint(1, 20)),
        alertas_baseline_en=ahora() - dt.timedelta(days=45),
        dfe_baseline_en=ahora() - dt.timedelta(days=45),
        activo=True,
    )

    if not es_ri:
        cat = cfg["cat"]
        cuota = float(CATEGORIAS[cat][cfg["act"]])
        desde_v, hasta_v, etiqueta = ventana_recategorizacion(hoy)
        if cfg.get("recat_abierta"):
            # Ventana por cerrar: es el momento en que el contador tiene que decidir.
            desde_v = (hoy - dt.timedelta(days=12)).isoformat()
            hasta_v = (hoy + dt.timedelta(days=10)).isoformat()
            etiqueta = dt.date.fromisoformat(hasta_v).strftime("%d/%m/%Y")
        cliente.categoria = cat
        cliente.actividad = cfg["act"]
        cliente.tope_categoria = float(CATEGORIAS[cat]["tope"])
        cliente.facturacion_12m = redondear(facturado12)
        cliente.facturometro_actualizado = (hoy - dt.timedelta(days=rng.randint(0, 2))).strftime("%d/%m/%Y")
        cliente.prox_recategorizacion = etiqueta
        cliente.recat_ventana_desde = desde_v
        cliente.recat_ventana_hasta = hasta_v
        cliente.recat_mostrar_alerta = bool(cfg.get("recat_abierta"))
        cliente.prox_venc_fecha = vencimiento_cuota(hoy).strftime("%d-%m-%Y")
        cliente.prox_venc_importe = cuota
        cliente.debito_automatico = bool(cfg.get("debito"))
        cliente.meses_adeudados = cfg.get("meses_adeudados", 0)
        cliente.cuota_estado = cfg.get("cuota", "al-dia")
        detalle = estado_de_cuenta(rng, cfg, hoy, cuota)
        cliente.cuota_deuda = detalle["deudor"] or None
        cliente.cuota_saldo_favor = detalle["acreedor"] or None
        cliente.deuda_detalle = json.dumps(detalle, ensure_ascii=False)
    else:
        cliente.facturacion_12m = redondear(facturado12)
        # El responsable inscripto no tiene cuenta corriente de monotributo: el estado de cuenta lo
        # dice con todas las letras en vez de quedarse en blanco.
        cliente.deuda_detalle = json.dumps({
            "no_aplica": True,
            "motivo": "Este cliente no tiene cuenta corriente de Monotributo ni de Autónomos.",
        }, ensure_ascii=False)

    if cfg.get("rel_dep"):
        meses = []
        bruto = rng.uniform(950_000, 1_450_000)
        for i in range(11, -1, -1):
            mes = sumar_meses(primer_dia(hoy.year, hoy.month), -i - 1)
            sac = mes.month in (6, 12)
            meses.append({
                "periodo": mes.strftime("%Y-%m"),
                "bruto": redondear(bruto * (1.021 ** (11 - i)) * (1.5 if sac else 1.0)),
                "incluye_sac": sac,
            })
        cliente.relacion_dependencia = True
        cliente.remuneraciones_json = json.dumps({
            "empleadores": [{"razon_social": "COOPERATIVA DE TRABAJO LA MERCED LTDA"}],
            "total_bruto": redondear(sum(m["bruto"] for m in meses)),
            "periodo_desde": meses[0]["periodo"].replace("-", ""),
            "periodo_hasta": meses[-1]["periodo"].replace("-", ""),
            "remuneraciones": meses,
        }, ensure_ascii=False)
        cliente.aportes_chequeado_en = ahora() - dt.timedelta(days=rng.randint(1, 15))
    db.add(cliente)
    db.flush()

    for fila in movimientos:
        db.add(models.ComprobanteEmitido(**fila))

    # Bitácora de actualizaciones: la ficha muestra cuándo se actualizó por última vez.
    for i in range(3):
        db.add(models.Extraccion(
            cuit=cuit,
            fecha=ahora() - dt.timedelta(hours=rng.randint(2, 9) + i * 13),
            resultado="exitosa",
            comprobantes=len([m for m in movimientos if m["direccion"] == "emitido"]) if i == 0 else 0,
            duracion_ms=rng.randint(18_000, 95_000),
        ))

    for com in comunicaciones_de(rng, cfg, cuit, hoy):
        nueva = com.pop("nueva")
        db.add(models.ComunicacionDFE(
            cuit=cuit,
            sistema="SISTEMA DE COMUNICACIONES Y NOTIFICACIONES",
            organismo="ARCA",
            tiene_adjunto=False,
            # Las nuevas entran después del baseline (por eso aparecen como novedad); las viejas,
            # antes.
            sincronizado_en=ahora() - (dt.timedelta(minutes=30) if nueva else dt.timedelta(days=60)),
            **com,
        ))

    # Extracto bancario cargado: sólo en una parte de la cartera, como pasa de verdad. Después de
    # cargarlo corre el mismo cruce que corre al importar un extracto: la conciliación se ve resuelta,
    # con los cobros pegados a su comprobante y los que no matchean esperando una decisión.
    resumen_banco = 0
    if not es_ri and movimientos and idx % 3 == 0:
        lote = f"demo-{cuit[-4:]}"
        for mov in movimientos_banco(rng, movimientos, hoy):
            db.add(models.MovimientoBancario(
                cuit=cuit, lote_id=lote,
                hash_dedup=hash_dedup(cuit, mov["fecha"], mov["monto"], mov["descripcion"],
                                      mov["cuit_originante"]),
                **mov,
            ))
            resumen_banco += 1
    db.commit()
    if resumen_banco:
        conciliacion_svc.reconciliar_pendientes(db, cuit)
    # Plan de cuentas ya armado en parte de la cartera: así el libro diario tiene sus asientos
    # derivados de los comprobantes. En el resto queda sin plan, que es el punto de partida real
    # (el contador lo siembra de un botón desde la ficha).
    if es_ri or idx % 4 == 0:
        contabilidad_svc.sembrar_plan(db, cuit)
    return {
        "cuit": cuit, "nombre": cfg["nombre"],
        "regimen": "RI" if es_ri else f"Mono {cfg['cat']}",
        "comprobantes": len(movimientos), "facturado12": facturado12, "banco": resumen_banco,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Arma la cuenta de demostración de Órbita.")
    parser.add_argument("--email", default=EMAIL_DEFAULT, help="Email con el que entra la demo.")
    parser.add_argument("--password", default="", help="Contraseña de la cuenta (mínimo 8).")
    parser.add_argument("--nombre", default="Cuenta")
    parser.add_argument("--apellido", default="Demostración")
    parser.add_argument("--estudio", default="Estudio Demo")
    parser.add_argument("--borrar", action="store_true",
                        help="Borra la cartera de ejemplo Y la cuenta, y termina.")
    parser.add_argument("--si", action="store_true", help="No pregunta antes de rehacer la cartera.")
    args = parser.parse_args()

    email = args.email.strip().lower()
    Base.metadata.create_all(bind=engine)
    asegurar_columnas()

    db = SessionLocal()
    try:
        existente = db.scalar(select(models.Usuario).where(models.Usuario.email == email))

        if args.borrar:
            if existente is None:
                print(f"No hay ninguna cuenta con {email}: nada para borrar.")
                return
            if not existente.demo:
                raise SystemExit(
                    f"{email} NO está marcada como cuenta de demostración. No se toca."
                )
            n = limpiar_cartera(db, existente.id)
            sus = db.scalar(
                select(models.Suscripcion).where(models.Suscripcion.usuario_id == existente.id)
            )
            if sus is not None:
                db.execute(delete(models.PagoSuscripcion).where(
                    models.PagoSuscripcion.suscripcion_id == sus.id
                ))
                db.delete(sus)
            db.delete(existente)
            db.commit()
            print(f"Listo: se borraron {n} clientes de ejemplo y la cuenta {email}.")
            return

        if existente is not None and not existente.demo:
            raise SystemExit(
                f"Ya existe una cuenta REAL con {email}. Elegí otro email para la demo "
                "(--email) o revisá el panel de administración."
            )
        if existente is not None and not args.si:
            print(f"La cuenta {email} ya existe (demo). Se va a REHACER su cartera de ejemplo.")
            if input("¿Seguimos? [s/N]: ").strip().lower() != "s":
                raise SystemExit("Cancelado: no se modificó nada.")
        if existente is None and not args.password:
            raise SystemExit("Falta --password: la cuenta es nueva y necesita una contraseña.")
        if args.password and len(args.password) < 8:
            raise SystemExit("La contraseña tiene que tener al menos 8 caracteres.")

        usuario = asegurar_usuario(db, email, args.password, args.nombre, args.apellido, args.estudio)
        borrados = limpiar_cartera(db, usuario.id)
        if borrados:
            print(f"Se limpió la cartera anterior ({borrados} clientes).")

        hoy = dt.date.today()
        print(cargar_categorias_oficiales())
        print(f"Generando {len(CARTERA)} clientes de ejemplo...")
        resumen = []
        for idx, cfg in enumerate(CARTERA):
            fila = sembrar_cliente(db, usuario, idx, cfg, hoy)
            resumen.append(fila)
            print(f"  {idx + 1:>2}. {fila['nombre'][:34]:<34} {fila['regimen']:<9} "
                  f"{fila['comprobantes']:>4} comprobantes  ${fila['facturado12']:,.0f}")

        monos = [r for r in resumen if r["regimen"] != "RI"]
        print("")
        print("Cuenta de demostración lista.")
        print(f"   Entrada:      {email}")
        if args.password:
            print(f"   Contraseña:   {args.password}")
        print(f"   Cartera:      {len(monos)} monotributistas + {len(resumen) - len(monos)} "
              "responsables inscriptos")
        print(f"   Comprobantes: {sum(r['comprobantes'] for r in resumen):,}")
        print(f"   Movimientos bancarios: {sum(r['banco'] for r in resumen):,}")
        print("   Plan: completo (ve todos los apartados). La cuenta está marcada como demo: "
              "queda fuera del motor de actualización y no le escribe a nadie.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
