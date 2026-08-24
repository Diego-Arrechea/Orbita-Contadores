"""Contabilidad asistida: plan de cuentas por cliente + libro diario derivado de los comprobantes.

Filosofía (la misma del Libro IVA): Órbita arma los asientos SOLO, con los comprobantes que ya tiene.
Los asientos de ventas y compras NO se persisten: se recalculan a partir de `ComprobanteEmitido` cada
vez que se pide el diario, así un comprobante que llega tarde (o que se corrige) queda reflejado sin
tener que reconciliar filas ya escritas. Lo único que se guarda es la DECISIÓN del contador: su plan
de cuentas (`CuentaContable`) y las reglas de imputación (`ReglaImputacion`).

El asiento se ancla en `imp_total` (el importe canónico, siempre en pesos): la cuenta de resultado se
calcula como total − IVA − percepciones, de modo que el asiento SIEMPRE cierra, incluso si el
desglose viene incompleto o con centavos de diferencia.
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..schemas import TIPOS_NOTA_CREDITO, nombre_tipo

# --- Plan de cuentas estándar (plantilla que se siembra; el contador la edita o importa la suya) ---
# (codigo, nombre, tipo, imputable). Los códigos de 1 y 3 dígitos son títulos: ordenan, no se imputan.
PLAN_ESTANDAR: tuple[tuple[str, str, str, bool], ...] = (
    ("1", "Activo", "activo", False),
    ("1.1", "Activo corriente", "activo", False),
    ("1.1.01", "Caja", "activo", True),
    ("1.1.02", "Banco cuenta corriente", "activo", True),
    ("1.1.03", "Deudores por ventas", "activo", True),
    ("1.1.04", "IVA crédito fiscal", "activo", True),
    ("1.1.05", "Saldo a favor de IVA", "activo", True),
    ("1.1.06", "Percepciones de IVA sufridas", "activo", True),
    ("1.1.07", "Percepciones de Ingresos Brutos sufridas", "activo", True),
    ("1.1.08", "Otros créditos fiscales", "activo", True),
    ("1.2", "Activo no corriente", "activo", False),
    ("1.2.01", "Bienes de uso", "activo", True),
    ("1.2.02", "Amortización acumulada de bienes de uso", "activo", True),
    ("2", "Pasivo", "pasivo", False),
    ("2.1", "Pasivo corriente", "pasivo", False),
    ("2.1.01", "Proveedores", "pasivo", True),
    ("2.1.02", "IVA débito fiscal", "pasivo", True),
    ("2.1.03", "IVA a pagar", "pasivo", True),
    ("2.1.04", "Percepciones de IVA practicadas", "pasivo", True),
    ("2.1.05", "Percepciones de Ingresos Brutos practicadas", "pasivo", True),
    ("2.1.06", "Cargas sociales a pagar", "pasivo", True),
    ("2.1.07", "Sueldos a pagar", "pasivo", True),
    ("2.1.08", "Otros impuestos a pagar", "pasivo", True),
    ("3", "Patrimonio neto", "patrimonio", False),
    ("3.1.01", "Capital", "patrimonio", True),
    ("3.1.02", "Resultados no asignados", "patrimonio", True),
    ("4", "Ingresos", "resultado_positivo", False),
    ("4.1.01", "Ventas", "resultado_positivo", True),
    ("4.1.02", "Otros ingresos", "resultado_positivo", True),
    ("5", "Egresos", "resultado_negativo", False),
    ("5.1.01", "Compras de mercadería", "resultado_negativo", True),
    ("5.1.02", "Gastos generales", "resultado_negativo", True),
    ("5.1.03", "Servicios públicos", "resultado_negativo", True),
    ("5.1.04", "Honorarios", "resultado_negativo", True),
    ("5.1.05", "Alquileres", "resultado_negativo", True),
    ("5.1.06", "Fletes y movilidad", "resultado_negativo", True),
    ("5.1.07", "Impuestos y tasas", "resultado_negativo", True),
    ("5.1.08", "Sueldos y jornales", "resultado_negativo", True),
    ("5.1.09", "Cargas sociales", "resultado_negativo", True),
    ("5.1.10", "Gastos bancarios", "resultado_negativo", True),
    ("5.1.11", "Amortizaciones", "resultado_negativo", True),
)

# Cuentas que USA el asiento automático. Si el contador importa su propio plan y no las trae, se
# crean igual al importar (sin ellas no habría dónde imputar). Tampoco se pueden borrar.
CTA_DEUDORES = "1.1.03"
CTA_IVA_CF = "1.1.04"
CTA_PERCEP_IVA_SUF = "1.1.06"
CTA_PERCEP_IIBB_SUF = "1.1.07"
CTA_OTROS_CRED_FISC = "1.1.08"
CTA_PROVEEDORES = "2.1.01"
CTA_IVA_DF = "2.1.02"
CTA_PERCEP_IVA_PRACT = "2.1.04"
CTA_PERCEP_IIBB_PRACT = "2.1.05"
CTA_OTROS_IMP_PAGAR = "2.1.08"
CTA_VENTAS = "4.1.01"
CTA_COMPRAS = "5.1.01"

CUENTAS_SISTEMA: tuple[str, ...] = (
    CTA_DEUDORES, CTA_IVA_CF, CTA_PERCEP_IVA_SUF, CTA_PERCEP_IIBB_SUF, CTA_OTROS_CRED_FISC,
    CTA_PROVEEDORES, CTA_IVA_DF, CTA_PERCEP_IVA_PRACT, CTA_PERCEP_IIBB_PRACT, CTA_OTROS_IMP_PAGAR,
    CTA_VENTAS, CTA_COMPRAS,
)

_MESES = (
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
)


def label_periodo(periodo: str) -> str:
    """Convierte el período crudo (aaaa-mm) en el nombre del mes. Cae al crudo si no matchea."""
    try:
        anio, mes = periodo.split("-")
        return f"{_MESES[int(mes)]} {anio}"
    except (ValueError, IndexError):
        return periodo


def rango_mes(periodo: str) -> tuple[dt.date, dt.date]:
    """Primer día del período y primer día del siguiente (fin EXCLUSIVO). Portable entre motores."""
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    desde = dt.date(anio, mes, 1)
    hasta = dt.date(anio + 1, 1, 1) if mes == 12 else dt.date(anio, mes + 1, 1)
    return desde, hasta


# --- Plan de cuentas ----------------------------------------------------------------------------
def cuentas_de(db: Session, cuit: str) -> list[models.CuentaContable]:
    """Plan de cuentas del cliente ordenado por código (el orden en el que lo lee el contador)."""
    cta = models.CuentaContable
    return list(db.execute(select(cta).where(cta.cuit == cuit).order_by(cta.codigo)).scalars())


def _asegurar_cuentas_sistema(db: Session, cuit: str) -> int:
    """Crea las cuentas que el asiento automático necesita y que el plan del cliente no tiene.

    Corre al sembrar y al importar (nunca al leer el diario): así el plan propio del estudio no deja
    al automático sin dónde imputar. Devuelve cuántas creó."""
    existentes = {c.codigo for c in cuentas_de(db, cuit)}
    faltan = [f for f in PLAN_ESTANDAR if f[0] in CUENTAS_SISTEMA and f[0] not in existentes]
    for codigo, nombre, tipo, imputable in faltan:
        db.add(models.CuentaContable(
            cuit=cuit, codigo=codigo, nombre=nombre, tipo=tipo, imputable=imputable
        ))
    if faltan:
        db.flush()
    return len(faltan)


def sembrar_plan(db: Session, cuit: str) -> int:
    """Siembra la plantilla estándar en el cliente. Idempotente: sólo agrega los códigos que faltan
    (no pisa lo que el contador ya editó). Devuelve cuántas cuentas creó."""
    existentes = {c.codigo for c in cuentas_de(db, cuit)}
    creadas = 0
    for codigo, nombre, tipo, imputable in PLAN_ESTANDAR:
        if codigo in existentes:
            continue
        db.add(models.CuentaContable(
            cuit=cuit, codigo=codigo, nombre=nombre, tipo=tipo, imputable=imputable
        ))
        creadas += 1
    db.commit()
    return creadas


def importar_plan(db: Session, cuit: str, filas: list) -> dict:
    """Importa el plan de cuentas que el estudio ya usa. Upsert por `codigo`: lo que existe se
    actualiza, lo nuevo se crea y NADA se borra (borrar es una acción explícita del contador).

    Devuelve {creadas, actualizadas, sistema}: `sistema` son las cuentas del asiento automático que
    hubo que agregar porque el plan importado no las traía."""
    por_codigo = {c.codigo: c for c in cuentas_de(db, cuit)}
    creadas = actualizadas = 0
    for fila in filas:
        existente = por_codigo.get(fila.codigo)
        if existente is None:
            nueva = models.CuentaContable(
                cuit=cuit, codigo=fila.codigo, nombre=fila.nombre,
                tipo=fila.tipo, imputable=fila.imputable,
            )
            db.add(nueva)
            por_codigo[fila.codigo] = nueva
            creadas += 1
        else:
            existente.nombre = fila.nombre
            existente.tipo = fila.tipo
            existente.imputable = fila.imputable
            actualizadas += 1
    db.flush()
    sistema = _asegurar_cuentas_sistema(db, cuit)
    db.commit()
    return {"creadas": creadas, "actualizadas": actualizadas, "sistema": sistema}


# --- Imputación ---------------------------------------------------------------------------------
def _solo_digitos(valor: str | None) -> str:
    return "".join(ch for ch in (valor or "") if ch.isdigit())


def _regla_que_matchea(
    comp: models.ComprobanteEmitido, lado: str, reglas: list[models.ReglaImputacion]
) -> models.ReglaImputacion | None:
    """Primera regla del contador que aplica al comprobante (ya vienen ordenadas por prioridad).
    Matchea por CUIT de la contraparte, o por texto contenido en su nombre, y opcionalmente por
    tipo de comprobante."""
    doc = _solo_digitos(comp.doc_nro)
    nombre = (comp.contraparte_nombre or "").lower()
    for regla in reglas:
        if regla.lado != lado:
            continue
        if regla.cbte_tipo is not None and regla.cbte_tipo != comp.cbte_tipo:
            continue
        if doc and regla.contraparte_cuit and _solo_digitos(regla.contraparte_cuit) == doc:
            return regla
        if regla.contraparte_texto and regla.contraparte_texto.strip().lower() in nombre:
            return regla
    return None


def _percepciones(comp: models.ComprobanteEmitido) -> dict[str, float]:
    """Percepciones del comprobante separadas por tipo. Si nunca se trajo el detalle de AFIP,
    `percepciones_json` es NULL y sólo tenemos el total lumpeado (`imp_trib`), que va a 'otros'."""
    if comp.percepciones_json:
        try:
            crudo = json.loads(comp.percepciones_json)
            datos = {k: float(v or 0) for k, v in crudo.items()}
            if any(datos.values()):
                return datos
        except (ValueError, TypeError, AttributeError):
            pass
    return {"otros": float(comp.imp_trib or 0)}


def _cuenta_percepcion(clave: str, lado: str) -> str:
    """Cuenta de cada tipo de percepción. En compras son sufridas (un crédito nuestro); en ventas,
    practicadas (deuda con el fisco). Lo que no es IVA ni Ingresos Brutos cae en la genérica."""
    if lado == "compras":
        if clave == "iva":
            return CTA_PERCEP_IVA_SUF
        if clave == "iibb":
            return CTA_PERCEP_IIBB_SUF
        return CTA_OTROS_CRED_FISC
    if clave == "iva":
        return CTA_PERCEP_IVA_PRACT
    if clave == "iibb":
        return CTA_PERCEP_IIBB_PRACT
    return CTA_OTROS_IMP_PAGAR


def asiento_de_comprobante(
    comp: models.ComprobanteEmitido,
    nombres: dict,
    reglas: list[models.ReglaImputacion],
) -> dict:
    """Arma el asiento de un comprobante. Venta: Deudores por ventas al debe, contra Ventas + IVA
    débito + percepciones practicadas al haber. Compra: la cuenta de gasto + IVA crédito +
    percepciones sufridas al debe, contra Proveedores al haber. Una nota de crédito invierte todo.

    El importe de la cuenta de resultado sale de total − IVA − percepciones para que el asiento
    cierre siempre (el total es el dato canónico; el desglose puede faltar)."""
    lado = "ventas" if comp.direccion == "emitido" else "compras"
    es_nc = comp.cbte_tipo in TIPOS_NOTA_CREDITO
    total = round(float(comp.imp_total or 0), 2)
    iva = round(float(comp.imp_iva or 0), 2)
    percep = {k: round(v, 2) for k, v in _percepciones(comp).items() if round(v, 2)}
    resultado = round(total - iva - sum(percep.values()), 2)

    regla = _regla_que_matchea(comp, lado, reglas)
    if regla is not None:
        cta_resultado = nombres.get(regla.cuenta_id) or (CTA_VENTAS if lado == "ventas" else CTA_COMPRAS)
        por_defecto = False
    else:
        cta_resultado = CTA_VENTAS if lado == "ventas" else CTA_COMPRAS
        # En ventas la cuenta por defecto casi siempre es la correcta; en compras no (puede ser
        # mercadería, un servicio, un honorario…), así que esos asientos se marcan para revisar.
        por_defecto = lado == "compras"

    lineas: list[dict] = []

    def sumar(codigo: str, importe: float, al_debe: bool, defecto: bool = False) -> None:
        if not importe:
            return
        # La nota de crédito invierte el asiento (revierte la operación original).
        debe = al_debe != es_nc
        lineas.append({
            "codigo": codigo,
            "cuenta": nombres.get(codigo, codigo),
            "debe": importe if debe else 0.0,
            "haber": 0.0 if debe else importe,
            "porDefecto": defecto,
        })

    if lado == "ventas":
        sumar(CTA_DEUDORES, total, al_debe=True)
        sumar(cta_resultado, resultado, al_debe=False, defecto=por_defecto)
        sumar(CTA_IVA_DF, iva, al_debe=False)
        for clave, importe in percep.items():
            sumar(_cuenta_percepcion(clave, lado), importe, al_debe=False)
    else:
        sumar(cta_resultado, resultado, al_debe=True, defecto=por_defecto)
        sumar(CTA_IVA_CF, iva, al_debe=True)
        for clave, importe in percep.items():
            sumar(_cuenta_percepcion(clave, lado), importe, al_debe=True)
        sumar(CTA_PROVEEDORES, total, al_debe=False)

    etiqueta = (
        f"{nombre_tipo(comp.cbte_tipo)} "
        f"{str(comp.punto_venta).zfill(5)}-{str(comp.numero).zfill(8)}"
    )
    return {
        "id": f"{comp.cuit}-{comp.direccion}-{comp.punto_venta}-{comp.cbte_tipo}-{comp.numero}",
        "fecha": comp.fecha.isoformat(),
        "lado": lado,
        "comprobante": etiqueta,
        "contraparte": comp.contraparte_nombre or "—",
        "detalle": ("Venta" if lado == "ventas" else "Compra") + f" · {etiqueta}",
        "lineas": lineas,
        "total": total,
        "revisar": any(linea["porDefecto"] for linea in lineas),
    }


# --- Libro diario -------------------------------------------------------------------------------
def periodos_con_comprobantes(db: Session, cuit: str) -> list[dict]:
    """Meses con comprobantes del cliente (más reciente primero), para el selector del diario."""
    comp = models.ComprobanteEmitido
    filas = db.execute(select(comp.fecha, comp.direccion).where(comp.cuit == cuit)).all()
    # Agrupa en Python (volumen por-cliente acotado; evita funciones de fecha propias de cada motor).
    conteo: dict[str, dict[str, int]] = {}
    for fecha, direccion in filas:
        slot = conteo.setdefault(fecha.strftime("%Y-%m"), {"ventas": 0, "compras": 0})
        slot["ventas" if direccion == "emitido" else "compras"] += 1
    return [
        {"periodo": p, "label": label_periodo(p), "ventas": v["ventas"], "compras": v["compras"]}
        for p, v in sorted(conteo.items(), reverse=True)
    ]


def diario(db: Session, cuit: str, periodo: str) -> dict:
    """Libro diario del período: un asiento por comprobante, ordenado por fecha. Si el cliente
    todavía no tiene plan de cuentas devuelve vacío con `sinPlan`, para que el front ofrezca
    sembrarlo o importarlo (sin plan no hay dónde imputar)."""
    cuentas = cuentas_de(db, cuit)
    if not cuentas:
        return {
            "cuit": cuit, "periodo": periodo, "asientos": [],
            "totales": {"asientos": 0, "debe": 0, "haber": 0, "revisar": 0}, "sinPlan": True,
        }

    # Un solo mapa con dos claves: por CÓDIGO devuelve el nombre (lo que usa el asiento automático) y
    # por ID de cuenta devuelve el código (lo que fija una regla del contador).
    nombres: dict = {c.codigo: c.nombre for c in cuentas}
    nombres.update({c.id: c.codigo for c in cuentas})

    regla = models.ReglaImputacion
    reglas = list(db.execute(
        select(regla).where(regla.cuit == cuit).order_by(regla.prioridad, regla.id)
    ).scalars())

    comp = models.ComprobanteEmitido
    desde, hasta = rango_mes(periodo)
    comprobantes = list(db.execute(
        select(comp)
        .where(comp.cuit == cuit, comp.fecha >= desde, comp.fecha < hasta)
        .order_by(comp.fecha, comp.id)
    ).scalars())

    asientos = [asiento_de_comprobante(c, nombres, reglas) for c in comprobantes]
    debe = round(sum(linea["debe"] for a in asientos for linea in a["lineas"]), 2)
    haber = round(sum(linea["haber"] for a in asientos for linea in a["lineas"]), 2)
    return {
        "cuit": cuit,
        "periodo": periodo,
        "asientos": asientos,
        "totales": {
            "asientos": len(asientos),
            "debe": debe,
            "haber": haber,
            "revisar": sum(1 for a in asientos if a["revisar"]),
        },
        "sinPlan": False,
    }
