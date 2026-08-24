"""Suscripciones de los contadores: catálogo de planes, estado de cada cuenta y cobranza manual.

Modelo mental: cada cuenta PLENA (titular o contador independiente; los empleados del estudio se
cubren con la suscripción del titular) tiene UNA `Suscripcion`. El catálogo `PLANES` define los
tres escalones (monitoreo → estudio → completo) con su precio de lista; la suscripción puede pisar
el precio y el tope de clientes (casi siempre hay un acuerdo particular).

La cobranza es MANUAL: el admin registra los pagos y cada pago corre el vencimiento hacia adelante.
El vencimiento NO corta el servicio: hoy sólo cambia el estado que se muestra. El corte automático
—y el aviso previo— se decide más adelante.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models

# --- Catálogo de planes ----------------------------------------------------------------------
# Tres escalones, cada uno suma funciones al anterior:
#   monitoreo → la cartera de monotributistas (el producto base)
#   estudio   → + el equipo del estudio (usuarios propios con permisos y cartera asignada)
#   completo  → + IVA y Contabilidad
# `precio` es el de lista por ciclo MENSUAL, en pesos, y sirve de referencia: el precio real de cada
# cuenta se guarda en la suscripción (Suscripcion.precio) porque suele haber acuerdos particulares.
# `limite_clientes = None` = sin tope (el diferencial entre planes son las funciones, no la cantidad
# de clientes; el tope se ajusta por cuenta si hace falta).
#
# OJO — el plan es INFORMATIVO: no habilita ni bloquea nada todavía. El acceso a IVA y Contabilidad
# lo sigue decidiendo su allowlist (IVA_EMAILS / CONTABILIDAD_EMAILS) y el equipo del estudio está
# disponible para todos. Atar el acceso al plan es el paso siguiente.
# Universo de funciones del producto, en el orden en que se muestran. Cada plan referencia las que
# incluye (por `clave`), así el front puede armar la comparativa: una fila por función, un tilde o
# una cruz por plan. `grupo` es el encabezado bajo el que se agrupan en esa tabla.
FUNCIONES: tuple[dict, ...] = (
    {"clave": "panel", "grupo": "Monotributo al día",
     "nombre": "Panel de tus monotributistas, actualizado solo"},
    {"clave": "alertas", "grupo": "Monotributo al día",
     "nombre": "Alertas de recategorización, tope de facturación y cuota impaga"},
    {"clave": "vencimientos", "grupo": "Monotributo al día",
     "nombre": "Recordatorios de vencimientos a tus clientes"},
    {"clave": "estado_cuenta", "grupo": "Monotributo al día",
     "nombre": "Estado de cuenta y deuda de cada cliente"},
    {"clave": "facturacion", "grupo": "Monotributo al día",
     "nombre": "Facturación electrónica desde la app"},
    {"clave": "conciliacion", "grupo": "Monotributo al día",
     "nombre": "Conciliación bancaria"},
    {"clave": "usuarios", "grupo": "Tu estudio",
     "nombre": "Usuarios para tu equipo, cada uno con su acceso"},
    {"clave": "permisos", "grupo": "Tu estudio",
     "nombre": "Cartera por responsable y permisos por persona"},
    {"clave": "iva", "grupo": "Impuestos y contabilidad",
     "nombre": "Libro IVA y declaraciones juradas"},
    {"clave": "contabilidad", "grupo": "Impuestos y contabilidad",
     "nombre": "Contabilidad: diario, mayor, balances y cierre de período"},
)

_BASE = ("panel", "alertas", "vencimientos", "estado_cuenta", "facturacion", "conciliacion")
_EQUIPO = ("usuarios", "permisos")
_IMPUESTOS = ("iva", "contabilidad")

PLANES: dict[str, dict] = {
    "monitoreo": {
        "nombre": "Monitoreo",
        "precio": 25000.0,
        "limite_clientes": None,
        "descripcion": "La cartera de monotributistas al día, sin tener que entrar a buscar nada.",
        "funciones": _BASE,
    },
    "estudio": {
        "nombre": "Estudio",
        "precio": 60000.0,
        "limite_clientes": None,
        "descripcion": "La cartera al día, con todo tu equipo trabajando adentro.",
        "funciones": _BASE + _EQUIPO,
    },
    "completo": {
        "nombre": "Completo",
        "precio": 110000.0,
        "limite_clientes": None,
        "descripcion": "El estudio completo: monotributo, IVA y contabilidad en un solo lugar.",
        "funciones": _BASE + _EQUIPO + _IMPUESTOS,
    },
}

PLAN_DEFAULT = "monitoreo"

ESTADOS = ("prueba", "activa", "vencida", "cancelada", "sin_cargo")
CICLOS = ("mensual", "anual")
MEDIOS_PAGO = ("transferencia", "efectivo", "mercadopago", "tarjeta", "otro")

# Días de tolerancia después del vencimiento antes de mostrar la cuenta como vencida. Da aire para
# que el pago se acredite/se cargue sin que el contador vea un cartel rojo de un día para el otro.
DIAS_GRACIA = 5


def _hoy() -> dt.date:
    return dt.date.today()


def _fecha(iso: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(iso) if iso else None
    except ValueError:
        return None


def sumar_ciclo(desde: dt.date, ciclo: str) -> dt.date:
    """La fecha en la que termina un ciclo que arranca en `desde` (mensual = mismo día del mes que
    viene; anual = mismo día del año que viene). Cae al último día del mes cuando no existe (31→30)."""
    if ciclo == "anual":
        try:
            return desde.replace(year=desde.year + 1)
        except ValueError:  # 29/02 en año no bisiesto
            return desde.replace(year=desde.year + 1, day=28)
    mes = desde.month + 1
    anio = desde.year + (1 if mes > 12 else 0)
    mes = 1 if mes > 12 else mes
    bisiesto = anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0)
    dias_mes = [31, 29 if bisiesto else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return dt.date(anio, mes, min(desde.day, dias_mes[mes - 1]))


def obtener_o_crear(db: Session, usuario: models.Usuario) -> models.Suscripcion:
    """La suscripción de la cuenta. Si todavía no tiene (cuentas anteriores a la feature, o recién
    registradas), se crea al vuelo en el plan por defecto y SIN cargo: nadie queda bloqueado ni
    vencido por el solo hecho de que estrenemos el apartado. El admin le asigna plan y precio
    cuando corresponde."""
    sus = db.scalar(select(models.Suscripcion).where(models.Suscripcion.usuario_id == usuario.id))
    if sus is not None:
        return sus
    inicio = usuario.creado_en.date() if usuario.creado_en else _hoy()
    sus = models.Suscripcion(
        usuario_id=usuario.id,
        plan=PLAN_DEFAULT,
        estado="sin_cargo",
        ciclo="mensual",
        inicio=inicio.isoformat(),
    )
    db.add(sus)
    db.commit()
    db.refresh(sus)
    return sus


def plan_de(sus: models.Suscripcion) -> dict:
    """Los datos de catálogo del plan de la suscripción (o el default si la clave quedó vieja)."""
    return PLANES.get(sus.plan) or PLANES[PLAN_DEFAULT]


def precio_efectivo(sus: models.Suscripcion) -> float:
    """Lo que efectivamente paga la cuenta por ciclo: el acuerdo particular si lo hay, si no el de
    lista (x12 cuando el ciclo es anual). Una cuenta en 'sin_cargo' paga 0 aunque su plan tenga
    precio de lista: el plan dice qué funciones tiene, el estado dice si se le cobra."""
    if sus.precio is not None:
        return float(sus.precio)
    if sus.estado == "sin_cargo":
        return 0.0
    base = float(plan_de(sus)["precio"])
    return base * 12 if sus.ciclo == "anual" else base


def limite_efectivo(sus: models.Suscripcion) -> int | None:
    """Tope de clientes de la cuenta: el particular si lo hay, si no el del plan. None = sin tope."""
    if sus.limite_clientes is not None:
        return sus.limite_clientes or None
    return plan_de(sus)["limite_clientes"]


def dias_restantes(sus: models.Suscripcion) -> int | None:
    """Días hasta el vencimiento (negativo si ya pasó). None cuando no hay vencimiento."""
    vence = _fecha(sus.vence)
    return (vence - _hoy()).days if vence else None


def estado_efectivo(sus: models.Suscripcion) -> str:
    """El estado REAL de hoy: el guardado, salvo que la fecha ya lo haya dejado vencido (con los
    días de gracia). 'cancelada' y 'sin_cargo' mandan siempre."""
    if sus.estado in ("cancelada", "sin_cargo"):
        return sus.estado
    dias = dias_restantes(sus)
    if dias is not None and dias < -DIAS_GRACIA:
        return "vencida"
    return sus.estado


def al_dia(sus: models.Suscripcion) -> bool:
    """True si la cuenta está en regla (no debe nada hoy)."""
    return estado_efectivo(sus) in ("activa", "prueba", "sin_cargo")


def clientes_de_la_cuenta(db: Session, usuario_id: int) -> int:
    """Clientes que consumen el cupo de la cuenta: los propios + los de sus empleados."""
    ids = [usuario_id] + [
        fila[0]
        for fila in db.execute(
            select(models.Usuario.id).where(models.Usuario.titular_id == usuario_id)
        ).all()
    ]
    return (
        db.scalar(
            select(func.count())
            .select_from(models.ClienteARCA)
            .where(models.ClienteARCA.usuario_id.in_(ids))
        )
        or 0
    )


def pagos_de(db: Session, sus: models.Suscripcion) -> list[models.PagoSuscripcion]:
    """Los pagos de la suscripción, del más reciente al más viejo."""
    return list(
        db.scalars(
            select(models.PagoSuscripcion)
            .where(models.PagoSuscripcion.suscripcion_id == sus.id)
            .order_by(models.PagoSuscripcion.fecha.desc(), models.PagoSuscripcion.id.desc())
        ).all()
    )


def registrar_pago(
    db: Session,
    sus: models.Suscripcion,
    *,
    fecha: str | None,
    importe: float,
    medio: str,
    periodo_desde: str | None,
    periodo_hasta: str | None,
    referencia: str | None,
    notas: str | None,
    registrado_por: str,
) -> models.PagoSuscripcion:
    """Carga un pago y corre el vencimiento de la suscripción.

    Si no vienen las fechas del período, se calculan solas: arranca donde terminaba lo ya pago (o
    hoy, si venía vencida) y dura un ciclo. El pago deja la suscripción 'activa' salvo que esté
    cancelada (ahí sólo queda el registro; reactivarla es una decisión explícita del admin)."""
    hoy = _hoy()
    f_pago = _fecha(fecha) or hoy
    desde = _fecha(periodo_desde)
    if desde is None:
        vigente = _fecha(sus.vence)
        desde = vigente if vigente and vigente > hoy else hoy
    hasta = _fecha(periodo_hasta) or sumar_ciclo(desde, sus.ciclo)

    pago = models.PagoSuscripcion(
        suscripcion_id=sus.id,
        fecha=f_pago.isoformat(),
        importe=importe,
        medio=medio if medio in MEDIOS_PAGO else "otro",
        periodo_desde=desde.isoformat(),
        periodo_hasta=hasta.isoformat(),
        referencia=(referencia or None),
        notas=(notas or None),
        registrado_por=registrado_por,
    )
    db.add(pago)

    vence_actual = _fecha(sus.vence)
    if vence_actual is None or hasta > vence_actual:
        sus.vence = hasta.isoformat()
    if sus.inicio is None:
        sus.inicio = desde.isoformat()
    if sus.estado != "cancelada":
        sus.estado = "activa"
        sus.cancelada_en = None
    sus.actualizada_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(pago)
    return pago
