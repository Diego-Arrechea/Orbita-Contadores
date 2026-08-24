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
CTA_BANCO = "1.1.02"
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
    CTA_BANCO, CTA_DEUDORES, CTA_IVA_CF, CTA_PERCEP_IVA_SUF, CTA_PERCEP_IIBB_SUF, CTA_OTROS_CRED_FISC,
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


def _elegir_regla(
    reglas: list[models.ReglaImputacion],
    lado: str,
    doc: str,
    nombre: str,
    cbte_tipo: int | None = None,
) -> models.ReglaImputacion | None:
    """Primera regla del contador que aplica (ya vienen ordenadas por prioridad). Matchea por CUIT de
    la contraparte, o por texto contenido en su nombre, y opcionalmente por tipo de comprobante."""
    nombre = (nombre or "").lower()
    for regla in reglas:
        if regla.lado != lado:
            continue
        if regla.cbte_tipo is not None and regla.cbte_tipo != cbte_tipo:
            continue
        if doc and regla.contraparte_cuit and _solo_digitos(regla.contraparte_cuit) == doc:
            return regla
        if regla.contraparte_texto and regla.contraparte_texto.strip().lower() in nombre:
            return regla
    return None


def _regla_que_matchea(
    comp: models.ComprobanteEmitido, lado: str, reglas: list[models.ReglaImputacion]
) -> models.ReglaImputacion | None:
    """La regla que aplica a un comprobante."""
    return _elegir_regla(
        reglas, lado, _solo_digitos(comp.doc_nro), comp.contraparte_nombre or "", comp.cbte_tipo
    )


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


def id_comprobante(comp: models.ComprobanteEmitido) -> str:
    """Id compuesto del comprobante, el mismo que usa el resto de la app."""
    return f"{comp.cuit}-{comp.direccion}-{comp.punto_venta}-{comp.cbte_tipo}-{comp.numero}"


def asiento_de_comprobante(
    comp: models.ComprobanteEmitido,
    nombres: dict,
    reglas: list[models.ReglaImputacion],
    imputaciones: dict[str, int] | None = None,
) -> dict:
    """Arma el asiento de un comprobante. Venta: Deudores por ventas al debe, contra Ventas + IVA
    débito + percepciones practicadas al haber. Compra: la cuenta de gasto + IVA crédito +
    percepciones sufridas al debe, contra Proveedores al haber. Una nota de crédito invierte todo.

    La cuenta de resultado sale, en este orden, de: la imputación que el contador fijó para ESE
    comprobante, la regla que matchee su contraparte, o la cuenta por defecto del lado.

    El importe de esa cuenta se calcula como total − IVA − percepciones para que el asiento cierre
    siempre (el total es el dato canónico; el desglose puede faltar)."""
    lado = "ventas" if comp.direccion == "emitido" else "compras"
    es_nc = comp.cbte_tipo in TIPOS_NOTA_CREDITO
    total = round(float(comp.imp_total or 0), 2)
    iva = round(float(comp.imp_iva or 0), 2)
    percep = {k: round(v, 2) for k, v in _percepciones(comp).items() if round(v, 2)}
    resultado = round(total - iva - sum(percep.values()), 2)

    comp_id = id_comprobante(comp)
    por_defecto = False
    origen_imputacion = "manual"
    cta_resultado = nombres.get((imputaciones or {}).get(comp_id, 0))
    if cta_resultado is None:
        origen_imputacion = "regla"
        regla = _regla_que_matchea(comp, lado, reglas)
        if regla is not None:
            cta_resultado = nombres.get(regla.cuenta_id)
    if cta_resultado is None:
        origen_imputacion = "defecto"
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
        "id": comp_id,
        "fecha": comp.fecha.isoformat(),
        "lado": lado,
        "comprobante": etiqueta,
        "contraparte": comp.contraparte_nombre or "—",
        "detalle": ("Venta" if lado == "ventas" else "Compra") + f" · {etiqueta}",
        "lineas": lineas,
        "total": total,
        "revisar": any(linea["porDefecto"] for linea in lineas),
        "origen": "comprobante",
        "cuentaImputada": cta_resultado,
        "imputacion": origen_imputacion,
        "contraparteCuit": _solo_digitos(comp.doc_nro),
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


def _contexto(db: Session, cuit: str) -> tuple[list, dict, list, dict]:
    """Todo lo que hace falta para imputar: plan, nombres, reglas e imputaciones puntuales.

    `nombres` lleva dos claves a propósito: por CÓDIGO devuelve el nombre (lo que usa el asiento
    automático) y por ID de cuenta devuelve el código (lo que fija una regla del contador)."""
    cuentas = cuentas_de(db, cuit)
    nombres: dict = {c.codigo: c.nombre for c in cuentas}
    nombres.update({c.id: c.codigo for c in cuentas})

    regla = models.ReglaImputacion
    reglas = list(db.execute(
        select(regla).where(regla.cuit == cuit).order_by(regla.prioridad, regla.id)
    ).scalars())
    imp = models.ImputacionComprobante
    imputaciones = {
        i.comprobante_id: i.cuenta_id
        for i in db.execute(select(imp).where(imp.cuit == cuit)).scalars()
    }
    return cuentas, nombres, reglas, imputaciones


def asientos_entre(
    db: Session,
    cuit: str,
    desde: dt.date | None,
    hasta: dt.date,
    nombres: dict,
    reglas: list,
    imputaciones: dict,
) -> list[dict]:
    """Asientos (los derivados de comprobantes y los manuales) con fecha en [desde, hasta).
    `desde=None` arranca en el primer movimiento del cliente: sirve para el saldo anterior."""
    comp = models.ComprobanteEmitido
    condiciones = [comp.cuit == cuit, comp.fecha < hasta]
    if desde is not None:
        condiciones.append(comp.fecha >= desde)
    comprobantes = db.execute(
        select(comp).where(*condiciones).order_by(comp.fecha, comp.id)
    ).scalars()

    asientos = [asiento_de_comprobante(c, nombres, reglas, imputaciones) for c in comprobantes]

    mov = models.MovimientoBancario
    cond_mov = [mov.cuit == cuit, mov.fecha < hasta]
    if desde is not None:
        cond_mov.append(mov.fecha >= desde)
    movimientos = db.execute(select(mov).where(*cond_mov).order_by(mov.fecha, mov.id)).scalars()
    asientos += [asiento_de_movimiento(m, nombres, reglas, imputaciones) for m in movimientos]

    asientos += asientos_manuales(db, cuit, desde or dt.date(1900, 1, 1), hasta, nombres)
    asientos.sort(key=lambda a: a["fecha"])
    return asientos


def _saldos_hasta(
    db: Session, cuit: str, hasta: dt.date, nombres: dict, reglas: list, imputaciones: dict
) -> dict[str, float]:
    """Saldo (debe − haber) de cada cuenta con todo lo anterior a `hasta`. Es el 'saldo anterior'
    con el que arrancan el mayor y las sumas y saldos."""
    saldos: dict[str, float] = {}
    for asiento in asientos_entre(db, cuit, None, hasta, nombres, reglas, imputaciones):
        for linea in asiento["lineas"]:
            saldos[linea["codigo"]] = round(
                saldos.get(linea["codigo"], 0) + linea["debe"] - linea["haber"], 2
            )
    return saldos


def diario(db: Session, cuit: str, periodo: str) -> dict:
    """Libro diario del período: un asiento por comprobante, ordenado por fecha. Si el cliente
    todavía no tiene plan de cuentas devuelve vacío con `sinPlan`, para que el front ofrezca
    sembrarlo o importarlo (sin plan no hay dónde imputar)."""
    cuentas, nombres, reglas, imputaciones = _contexto(db, cuit)
    if not cuentas:
        return {
            "cuit": cuit, "periodo": periodo, "asientos": [],
            "totales": {"asientos": 0, "debe": 0, "haber": 0, "revisar": 0}, "sinPlan": True,
        }

    desde, hasta = rango_mes(periodo)
    asientos = asientos_entre(db, cuit, desde, hasta, nombres, reglas, imputaciones)
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


# --- Decisiones del contador: imputación puntual y reglas ---------------------------------------
def _cuenta_imputable(db: Session, cuit: str, cuenta_id: int) -> models.CuentaContable:
    """La cuenta del plan de ESE cliente, si existe y se puede imputar. ValueError si no."""
    cuenta = db.get(models.CuentaContable, cuenta_id)
    if cuenta is None or cuenta.cuit != cuit:
        raise ValueError("Esa cuenta no está en el plan de este cliente.")
    if not cuenta.imputable:
        raise ValueError(
            f"{cuenta.codigo} {cuenta.nombre} es un título: elegí una cuenta imputable."
        )
    return cuenta


def comprobante_por_id(db: Session, cuit: str, comprobante_id: str) -> models.ComprobanteEmitido:
    """Busca el comprobante por su id compuesto. ValueError si el id no corresponde al cliente."""
    partes = comprobante_id.split("-")
    if len(partes) != 5 or partes[0] != cuit:
        raise ValueError("Comprobante inválido.")
    _, direccion, pv, tipo, numero = partes
    comp = models.ComprobanteEmitido
    try:
        fila = db.scalar(
            select(comp).where(
                comp.cuit == cuit,
                comp.direccion == direccion,
                comp.punto_venta == int(pv),
                comp.cbte_tipo == int(tipo),
                comp.numero == int(numero),
            )
        )
    except ValueError as e:
        raise ValueError("Comprobante inválido.") from e
    if fila is None:
        raise ValueError("No encontramos ese comprobante.")
    return fila


def guardar_imputacion(
    db: Session, cuit: str, comprobante_id: str, cuenta_id: int, email: str, recordar: bool
) -> dict:
    """Fija a mano la cuenta de un comprobante. Con `recordar`, además deja la regla para que los
    próximos de esa misma contraparte salgan imputados igual (y actualiza la regla si ya había una).

    Devuelve {ok, regla}: `regla` dice si quedó guardada la preferencia para la contraparte."""
    _cuenta_imputable(db, cuit, cuenta_id)
    es_banco = comprobante_id.startswith("banco-")
    if es_banco:
        mov = movimiento_por_id(db, cuit, comprobante_id)
        lado = "cobros" if mov.tipo != "debito" else "pagos"
        doc = _solo_digitos(mov.cuit_originante)
        texto = (mov.nombre_originante or mov.descripcion or "").strip()
    else:
        comp = comprobante_por_id(db, cuit, comprobante_id)
        lado = "ventas" if comp.direccion == "emitido" else "compras"
        doc = _solo_digitos(comp.doc_nro)
        texto = (comp.contraparte_nombre or "").strip()

    imp = models.ImputacionComprobante
    actual = db.scalar(select(imp).where(imp.cuit == cuit, imp.comprobante_id == comprobante_id))
    if actual is None:
        actual = models.ImputacionComprobante(
            cuit=cuit, comprobante_id=comprobante_id, creada_por=email
        )
        db.add(actual)
    actual.cuenta_id = cuenta_id

    guardo_regla = False
    if recordar:
        regla = models.ReglaImputacion
        if len(doc) == 11:  # con CUIT la regla es exacta; si no, se matchea por el nombre
            existente = db.scalar(
                select(regla).where(
                    regla.cuit == cuit, regla.lado == lado, regla.contraparte_cuit == doc
                )
            )
            nueva = models.ReglaImputacion(
                cuit=cuit, lado=lado, contraparte_cuit=doc, cuenta_id=cuenta_id,
                prioridad=10, creada_por=email,
            )
        else:
            if not texto:
                raise ValueError("Esto no tiene datos de la contraparte para recordar.")
            existente = db.scalar(
                select(regla).where(
                    regla.cuit == cuit, regla.lado == lado, regla.contraparte_texto == texto
                )
            )
            nueva = models.ReglaImputacion(
                cuit=cuit, lado=lado, contraparte_texto=texto, cuenta_id=cuenta_id,
                prioridad=20, creada_por=email,
            )
        if existente is not None:
            existente.cuenta_id = cuenta_id
        else:
            db.add(nueva)
        guardo_regla = True

    db.commit()
    return {"ok": True, "regla": guardo_regla}


def borrar_imputacion(db: Session, cuit: str, comprobante_id: str) -> dict:
    """Saca la imputación manual: el comprobante vuelve a la regla o a la cuenta por defecto."""
    imp = models.ImputacionComprobante
    actual = db.scalar(select(imp).where(imp.cuit == cuit, imp.comprobante_id == comprobante_id))
    if actual is not None:
        db.delete(actual)
        db.commit()
    return {"ok": True}


def reglas_de(db: Session, cuit: str) -> list[dict]:
    """Reglas de imputación automática del cliente, listas para mostrar."""
    regla = models.ReglaImputacion
    filas = list(db.execute(
        select(regla).where(regla.cuit == cuit).order_by(regla.prioridad, regla.id)
    ).scalars())
    cuentas = {c.id: c for c in cuentas_de(db, cuit)}
    salida = []
    for r in filas:
        cuenta = cuentas.get(r.cuenta_id)
        salida.append({
            "id": r.id,
            "lado": r.lado,
            "contraparte": r.contraparte_cuit or r.contraparte_texto or "—",
            "codigo": cuenta.codigo if cuenta else "",
            "cuenta": cuenta.nombre if cuenta else "(cuenta borrada)",
        })
    return salida


def borrar_regla(db: Session, cuit: str, regla_id: int) -> bool:
    """Borra una regla del cliente. False si no existe o es de otro cliente."""
    regla = db.get(models.ReglaImputacion, regla_id)
    if regla is None or regla.cuit != cuit:
        return False
    db.delete(regla)
    db.commit()
    return True


# --- Asientos manuales --------------------------------------------------------------------------
def asientos_manuales(
    db: Session, cuit: str, desde: dt.date, hasta: dt.date, nombres: dict
) -> list[dict]:
    """Asientos cargados a mano con fecha en el período, con el mismo formato que los derivados."""
    asi = models.AsientoManual
    cabeceras = list(db.execute(
        select(asi)
        .where(asi.cuit == cuit, asi.fecha >= desde, asi.fecha < hasta)
        .order_by(asi.fecha, asi.id)
    ).scalars())
    if not cabeceras:
        return []

    lin = models.LineaAsientoManual
    por_asiento: dict[int, list[models.LineaAsientoManual]] = {}
    filas = db.execute(
        select(lin).where(lin.asiento_id.in_([c.id for c in cabeceras])).order_by(lin.id)
    ).scalars()
    for fila in filas:
        por_asiento.setdefault(fila.asiento_id, []).append(fila)

    salida = []
    for cab in cabeceras:
        lineas = []
        for fila in por_asiento.get(cab.id, []):
            codigo = nombres.get(fila.cuenta_id, "")
            lineas.append({
                "codigo": codigo,
                "cuenta": nombres.get(codigo, codigo),
                "debe": round(float(fila.debe or 0), 2),
                "haber": round(float(fila.haber or 0), 2),
                "porDefecto": False,
            })
        salida.append({
            "id": f"manual-{cab.id}",
            "fecha": cab.fecha.isoformat(),
            "lado": "manual",
            "comprobante": cab.detalle,
            "contraparte": "—",
            "detalle": cab.detalle,
            "lineas": lineas,
            "total": round(sum(x["debe"] for x in lineas), 2),
            "revisar": False,
            "origen": "manual",
            "cuentaImputada": None,
            "imputacion": "defecto",
            "contraparteCuit": "",
        })
    return salida


def crear_asiento_manual(db: Session, cuit: str, datos, email: str) -> int:
    """Crea un asiento manual (el schema ya validó que cierre). Devuelve su id."""
    for linea in datos.lineas:
        _cuenta_imputable(db, cuit, linea.cuentaId)
    cabecera = models.AsientoManual(
        cuit=cuit, fecha=datos.fecha, detalle=datos.detalle.strip(), creado_por=email
    )
    db.add(cabecera)
    db.flush()
    for linea in datos.lineas:
        db.add(models.LineaAsientoManual(
            asiento_id=cabecera.id, cuenta_id=linea.cuentaId,
            debe=round(linea.debe, 2), haber=round(linea.haber, 2),
        ))
    db.commit()
    return cabecera.id


def borrar_asiento_manual(db: Session, cuit: str, asiento_id: int) -> bool:
    """Borra un asiento manual y sus renglones. False si no existe o es de otro cliente.

    Los renglones se borran PRIMERO: en Postgres la FK no deja borrar el padre con hijos."""
    cabecera = db.get(models.AsientoManual, asiento_id)
    if cabecera is None or cabecera.cuit != cuit:
        return False
    lin = models.LineaAsientoManual
    for fila in db.execute(select(lin).where(lin.asiento_id == asiento_id)).scalars():
        db.delete(fila)
    db.flush()
    db.delete(cabecera)
    db.commit()
    return True


# --- Informes: mayor y sumas y saldos ------------------------------------------------------------
def mayor(db: Session, cuit: str, codigo: str, desde: dt.date, hasta: dt.date) -> dict:
    """Movimientos de UNA cuenta entre dos fechas (`hasta` inclusive), con el saldo arrastrado.

    Arranca del saldo anterior (todo lo registrado antes de `desde`) y va acumulando renglón por
    renglón, que es como el contador lee un mayor."""
    cuentas, nombres, reglas, imputaciones = _contexto(db, cuit)
    cuenta = next((c for c in cuentas if c.codigo == codigo), None)
    if cuenta is None:
        raise ValueError("Esa cuenta no está en el plan de este cliente.")

    fin = hasta + dt.timedelta(days=1)  # `hasta` lo elige el contador: es inclusive
    saldo = _saldos_hasta(db, cuit, desde, nombres, reglas, imputaciones).get(codigo, 0.0)
    saldo_anterior = saldo

    movimientos = []
    debe_total = haber_total = 0.0
    for asiento in asientos_entre(db, cuit, desde, fin, nombres, reglas, imputaciones):
        for linea in asiento["lineas"]:
            if linea["codigo"] != codigo:
                continue
            saldo = round(saldo + linea["debe"] - linea["haber"], 2)
            debe_total = round(debe_total + linea["debe"], 2)
            haber_total = round(haber_total + linea["haber"], 2)
            movimientos.append({
                "fecha": asiento["fecha"],
                "detalle": asiento["detalle"],
                "contraparte": asiento["contraparte"],
                "debe": linea["debe"],
                "haber": linea["haber"],
                "saldo": saldo,
            })

    return {
        "cuit": cuit,
        "codigo": codigo,
        "cuenta": cuenta.nombre,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "saldoAnterior": saldo_anterior,
        "movimientos": movimientos,
        "debe": debe_total,
        "haber": haber_total,
        "saldo": saldo,
    }


def sumas_y_saldos(db: Session, cuit: str, desde: dt.date, hasta: dt.date) -> dict:
    """Sumas del debe y del haber de cada cuenta entre dos fechas (`hasta` inclusive) y su saldo.

    El saldo sale del saldo anterior más los movimientos del rango, y se muestra en la columna que
    corresponde: deudor si da positivo, acreedor si da negativo. Los totales de las cuatro columnas
    tienen que cerrar."""
    cuentas, nombres, reglas, imputaciones = _contexto(db, cuit)
    if not cuentas:
        return {
            "cuit": cuit, "desde": desde.isoformat(), "hasta": hasta.isoformat(), "filas": [],
            "debe": 0, "haber": 0, "deudor": 0, "acreedor": 0, "sinPlan": True,
        }

    fin = hasta + dt.timedelta(days=1)
    anteriores = _saldos_hasta(db, cuit, desde, nombres, reglas, imputaciones)
    movimientos: dict[str, dict[str, float]] = {}
    for asiento in asientos_entre(db, cuit, desde, fin, nombres, reglas, imputaciones):
        for linea in asiento["lineas"]:
            slot = movimientos.setdefault(linea["codigo"], {"debe": 0.0, "haber": 0.0})
            slot["debe"] = round(slot["debe"] + linea["debe"], 2)
            slot["haber"] = round(slot["haber"] + linea["haber"], 2)

    por_codigo = {c.codigo: c for c in cuentas}
    filas = []
    debe_total = haber_total = deudor_total = acreedor_total = 0.0
    for codigo in sorted(set(movimientos) | {c for c, s in anteriores.items() if s}):
        cuenta = por_codigo.get(codigo)
        mov = movimientos.get(codigo, {"debe": 0.0, "haber": 0.0})
        anterior = round(anteriores.get(codigo, 0.0), 2)
        saldo = round(anterior + mov["debe"] - mov["haber"], 2)
        filas.append({
            "codigo": codigo,
            "cuenta": cuenta.nombre if cuenta else "(cuenta borrada)",
            "tipo": cuenta.tipo if cuenta else "activo",
            "saldoAnterior": anterior,
            "debe": mov["debe"],
            "haber": mov["haber"],
            "saldoDeudor": saldo if saldo > 0 else 0.0,
            "saldoAcreedor": -saldo if saldo < 0 else 0.0,
        })
        debe_total = round(debe_total + mov["debe"], 2)
        haber_total = round(haber_total + mov["haber"], 2)
        deudor_total = round(deudor_total + (saldo if saldo > 0 else 0), 2)
        acreedor_total = round(acreedor_total + (-saldo if saldo < 0 else 0), 2)

    return {
        "cuit": cuit,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "filas": filas,
        "debe": debe_total,
        "haber": haber_total,
        "deudor": deudor_total,
        "acreedor": acreedor_total,
        "sinPlan": False,
    }


# --- Cobros y pagos (movimientos del extracto) ---------------------------------------------------
def id_movimiento(mov: models.MovimientoBancario) -> str:
    """Id del asiento que sale de un movimiento del extracto (se distingue de los comprobantes)."""
    return f"banco-{mov.id}"


def asiento_de_movimiento(
    mov: models.MovimientoBancario,
    nombres: dict,
    reglas: list[models.ReglaImputacion],
    imputaciones: dict[str, int],
) -> dict:
    """Arma el asiento de un movimiento del extracto. Un cobro entra al banco contra Deudores por
    ventas (cancela lo que el cliente debía); un pago sale del banco contra Proveedores.

    La cuenta de la contrapartida sigue la misma cadena que en los comprobantes: la que el contador
    fijó para ESE movimiento, la que memorizó para esa contraparte, o la de por defecto. Un cobro que
    quedó conciliado con un comprobante NO pide revisión (ya sabemos qué cancela); un pago sí, porque
    puede ser un proveedor, un impuesto, un sueldo o una transferencia entre cuentas propias."""
    es_cobro = mov.tipo != "debito"
    lado = "cobros" if es_cobro else "pagos"
    total = round(float(mov.monto or 0), 2)
    mov_id = id_movimiento(mov)
    contraparte = (mov.nombre_originante or mov.descripcion or "").strip() or "—"
    doc = _solo_digitos(mov.cuit_originante)

    por_defecto = False
    origen_imputacion = "manual"
    cta_contra = nombres.get(imputaciones.get(mov_id, 0))
    if cta_contra is None:
        origen_imputacion = "regla"
        regla = _elegir_regla(reglas, lado, doc, contraparte)
        if regla is not None:
            cta_contra = nombres.get(regla.cuenta_id)
    if cta_contra is None:
        origen_imputacion = "defecto"
        cta_contra = CTA_DEUDORES if es_cobro else CTA_PROVEEDORES
        por_defecto = not (es_cobro and mov.comprobante_matcheado_id)

    def linea(codigo: str, debe: float, haber: float, defecto: bool = False) -> dict:
        return {
            "codigo": codigo,
            "cuenta": nombres.get(codigo, codigo),
            "debe": debe,
            "haber": haber,
            "porDefecto": defecto,
        }

    if es_cobro:
        lineas = [linea(CTA_BANCO, total, 0.0), linea(cta_contra, 0.0, total, por_defecto)]
    else:
        lineas = [linea(cta_contra, total, 0.0, por_defecto), linea(CTA_BANCO, 0.0, total)]

    etiqueta = "Cobro" if es_cobro else "Pago"
    detalle = (mov.descripcion or "").strip() or contraparte
    return {
        "id": mov_id,
        "fecha": mov.fecha.isoformat(),
        "lado": lado,
        "comprobante": f"{etiqueta} · {detalle}"[:120],
        "contraparte": contraparte,
        "detalle": f"{etiqueta} · {detalle}"[:120],
        "lineas": lineas,
        "total": total,
        "revisar": por_defecto,
        "origen": "banco",
        "cuentaImputada": cta_contra,
        "imputacion": origen_imputacion,
        "contraparteCuit": doc,
    }


def movimiento_por_id(db: Session, cuit: str, asiento_id: str) -> models.MovimientoBancario:
    """Busca el movimiento del extracto por el id de su asiento ('banco-<n>'). ValueError si no es
    de este cliente."""
    try:
        mov_id = int(asiento_id.split("-", 1)[1])
    except (IndexError, ValueError) as e:
        raise ValueError("Movimiento inválido.") from e
    mov = db.get(models.MovimientoBancario, mov_id)
    if mov is None or mov.cuit != cuit:
        raise ValueError("No encontramos ese movimiento.")
    return mov
