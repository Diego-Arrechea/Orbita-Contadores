"""Suscripciones de los contadores: catálogo de planes, estado de cada cuenta y cobranza manual.

Modelo mental: cada cuenta PLENA (titular o contador independiente; los empleados del estudio se
cubren con la suscripción del titular) tiene UNA `Suscripcion`. El catálogo `PLANES` define los
tres escalones (monitoreo → estudio → completo) con su precio de lista; la suscripción puede pisar
el precio y el tope de clientes (casi siempre hay un acuerdo particular).

El PLAN decide qué funciones puede usar la cuenta: `funciones_de()` resuelve el acceso efectivo
(plan + estado + excepciones por cuenta) y de ahí toman tanto el enforcement del backend
(`security.requiere_funcion`) como lo que el front muestra. Cambiar el plan de una cuenta le
habilita o le apaga las secciones correspondientes sin ningún paso extra.

La cobranza es MANUAL: el admin registra los pagos y cada pago corre el vencimiento hacia adelante.
Una cuenta que queda vencida (pasados los días de gracia) o cancelada NO pierde el acceso a la app:
cae a FUNCIONES_DEGRADADO — sigue viendo su cartera, sus alertas y sus vencimientos, y pierde lo
que implica producir o dar acceso a más gente.
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from . import email as email_svc

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
# El plan MANDA: lo que incluye es lo que la cuenta puede usar. `funciones_de()` resuelve el acceso
# efectivo (plan + estado + excepciones por cuenta) y `security.requiere_funcion()` lo enforca en
# cada endpoint; el front esconde lo que no corresponde con el mismo dato (UsuarioOut.funciones).
# Universo de funciones del producto, en el orden en que se muestran. Cada plan referencia las que
# incluye (por `clave`), así el front puede armar la comparativa: una fila por función, un tilde o
# una cruz por plan. `grupo` es el encabezado bajo el que se agrupan en esa tabla.
# `nucleo` = viene con cualquier plan y NO se puede apagar (es el producto base: sin esto no hay app).
FUNCIONES: tuple[dict, ...] = (
    {"clave": "panel", "nucleo": True, "grupo": "Monotributo al día",
     "nombre": "Panel de tus monotributistas, actualizado solo"},
    {"clave": "alertas", "nucleo": True, "grupo": "Monotributo al día",
     "nombre": "Alertas de recategorización, tope de facturación y cuota impaga"},
    {"clave": "vencimientos", "grupo": "Monotributo al día",
     "nombre": "Recordatorios de vencimientos a tus clientes"},
    {"clave": "estado_cuenta", "nucleo": True, "grupo": "Monotributo al día",
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

# Todas las claves del catálogo, en orden de presentación.
CLAVES_FUNCIONES: tuple[str, ...] = tuple(f["clave"] for f in FUNCIONES)

# El producto base: viene con cualquier plan y no se puede apagar (ni por plan, ni por excepción,
# ni por falta de pago). Si esto se apagara no quedaría app que usar.
FUNCIONES_NUCLEO: frozenset[str] = frozenset(f["clave"] for f in FUNCIONES if f.get("nucleo"))

# A qué queda reducida una cuenta que no está en regla (ver ESTADOS_SIN_SERVICIO): conserva el
# monitoreo de la cartera —para que no pierda de vista a sus clientes ni los vencimientos— pero
# pierde lo que implica producir o dar acceso a más gente (facturar, equipo, IVA, contabilidad).
FUNCIONES_DEGRADADO: frozenset[str] = FUNCIONES_NUCLEO | frozenset(
    {"vencimientos", "conciliacion"}
)

# Estados en los que la cuenta deja de tener el plan completo y cae a FUNCIONES_DEGRADADO.
# 'vencida' es el estado EFECTIVO (ya contempla los días de gracia), no el guardado.
ESTADOS_SIN_SERVICIO: tuple[str, ...] = ("vencida", "cancelada")

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


# --- Qué puede usar la cuenta (el plan atado a las funciones) ---------------------------------
# Tres capas, en este orden:
#   1. el PLAN define el set base (PLANES[...]["funciones"]),
#   2. el ESTADO lo puede recortar: una cuenta que no está en regla cae a FUNCIONES_DEGRADADO,
#   3. las EXCEPCIONES por cuenta (Suscripcion.funciones_json) pisan lo anterior en los dos
#      sentidos — sumar una función fuera del plan (acuerdo particular, piloto) o sacarla.
# El núcleo queda SIEMPRE encendido, pase lo que pase.


def overrides_de(sus: models.Suscripcion) -> dict[str, bool]:
    """Las excepciones guardadas para esta cuenta ({clave: True/False}). Ignora claves que ya no
    existen en el catálogo y el núcleo (no se puede apagar)."""
    try:
        crudo = json.loads(sus.funciones_json) if sus.funciones_json else {}
    except ValueError:
        return {}
    if not isinstance(crudo, dict):
        return {}
    return {
        clave: bool(valor)
        for clave, valor in crudo.items()
        if clave in CLAVES_FUNCIONES and clave not in FUNCIONES_NUCLEO
    }


def serializar_overrides(overrides: dict[str, bool] | None) -> str | None:
    """Normaliza las excepciones para guardarlas. Vacío → NULL (la cuenta sigue el plan a secas)."""
    limpio = {
        clave: bool(valor)
        for clave, valor in (overrides or {}).items()
        if clave in CLAVES_FUNCIONES and clave not in FUNCIONES_NUCLEO
    }
    return json.dumps(limpio, ensure_ascii=False) if limpio else None


def funciones_de(sus: models.Suscripcion) -> dict[str, bool]:
    """Qué puede usar HOY esta cuenta: {clave: True/False} sobre todo el catálogo."""
    incluidas = set(plan_de(sus)["funciones"])
    if estado_efectivo(sus) in ESTADOS_SIN_SERVICIO:
        incluidas &= set(FUNCIONES_DEGRADADO)
    for clave, activa in overrides_de(sus).items():
        incluidas.add(clave) if activa else incluidas.discard(clave)
    incluidas |= FUNCIONES_NUCLEO
    return {clave: clave in incluidas for clave in CLAVES_FUNCIONES}


NOMBRES_FUNCIONES: dict[str, str] = {f["clave"]: f["nombre"] for f in FUNCIONES}


def funciones_que_pierde(sus: models.Suscripcion) -> list[str]:
    """Los NOMBRES de las secciones que la cuenta deja de tener el día que venza (en lenguaje del
    contador, para el aviso previo). Vacío si no pierde nada: ya está degradada, o su plan no
    incluye nada por encima del set mínimo."""
    hoy = set(k for k, v in funciones_de(sus).items() if v)
    despues = (hoy & set(FUNCIONES_DEGRADADO)) | FUNCIONES_NUCLEO
    return [NOMBRES_FUNCIONES[c] for c in CLAVES_FUNCIONES if c in hoy and c not in despues]


def avisar_vencimientos(db: Session, hoy: dt.date | None = None, dias: int = 7) -> dict:
    """Manda el aviso previo a los titulares cuya suscripción vence dentro de `dias`.

    Vencer degrada la cuenta (pierde facturación, equipo, IVA y contabilidad hasta regularizar), así
    que el contador tiene que enterarse ANTES y sin depender de que entre a la app. UNO por
    vencimiento: al mandarlo se marca `aviso_vence_enviado` con esa fecha, y si después se registra
    un pago el `vence` cambia y el aviso vuelve a habilitarse solo. Si el mail no sale (SMTP caído)
    no se marca y se reintenta en la próxima pasada. Devuelve un resumen."""
    hoy = hoy or _hoy()
    limite = (hoy + dt.timedelta(days=dias)).isoformat()
    candidatas = db.scalars(
        select(models.Suscripcion).where(
            models.Suscripcion.estado.in_(("activa", "prueba")),
            models.Suscripcion.vence.is_not(None),
            models.Suscripcion.vence <= limite,
            models.Suscripcion.vence >= hoy.isoformat(),
        )
    ).all()

    enviados = 0
    for sus in candidatas:
        if sus.aviso_vence_enviado == sus.vence:
            continue  # ya avisamos por este vencimiento
        titular = db.get(models.Usuario, sus.usuario_id)
        if titular is None or not titular.activo:
            continue
        restantes = dias_restantes(sus)
        if email_svc.enviar_aviso_vencimiento(
            titular, sus.vence, restantes if restantes is not None else 0, funciones_que_pierde(sus)
        ):
            sus.aviso_vence_enviado = sus.vence
            db.commit()
            enviados += 1
    return {"candidatas": len(candidatas), "enviados": enviados}


def suscripcion_vigente(db: Session, usuario: models.Usuario) -> models.Suscripcion | None:
    """La suscripción que gobierna a este usuario, SIN escribir en la base: la propia si es una
    cuenta plena, la del titular si es un usuario del estudio (el equipo se cubre con la del
    titular). None si todavía no tiene fila."""
    dueño_id = usuario.titular_id or usuario.id
    return db.scalar(
        select(models.Suscripcion).where(models.Suscripcion.usuario_id == dueño_id)
    )


def funciones_de_usuario(db: Session, usuario: models.Usuario) -> dict[str, bool]:
    """Las funciones habilitadas para este usuario. Los ADMIN de Órbita pueden todo (operan el
    sistema). Una cuenta sin fila de suscripción se evalúa con el plan por defecto: no queda
    bloqueada de entrada, pero tampoco hereda funciones que no le corresponden."""
    if usuario.rol == "admin":
        return {clave: True for clave in CLAVES_FUNCIONES}
    sus = suscripcion_vigente(db, usuario) or models.Suscripcion(
        usuario_id=usuario.id, plan=PLAN_DEFAULT, estado="sin_cargo", ciclo="mensual"
    )
    return funciones_de(sus)


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
