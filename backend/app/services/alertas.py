"""
Motor de alertas del backend + notificación por WhatsApp.

Evalúa el set COMPLETO de alertas de cada cliente (tope, recategorización, ventana, gastos, cuota,
vencimiento, falla de datos) reusando el mismo cálculo que muestra la app: arma el `ClienteOut` (igual
que el dashboard) y lo pasa por `monotributo.calcular_cliente` + `derivar_alertas`, espejo de
`src/lib/alertas.ts::derivarAlertas`.

Cada contador configura en su cuenta (config_json.notificaciones): si recibe alertas, en qué ventana
horaria, qué nivel de severidad y qué tipos. El motor respeta esa config.

"Solo lo nuevo": la tabla `alertas_enviadas` lleva el ESTADO de cada alerta por contador
(clave = cuit+tipo+severidad). Una alerta se envía UNA vez cuando aparece (queda `activa=True`); no se
reenvía mientras persiste; cuando se resuelve se marca `activa=False`, así si reaparece vuelve a
avisar. Reemplaza al viejo cooldown por tiempo.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from . import monotributo, whatsapp

logger = logging.getLogger("orbita.alertas")

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

VENC_AVISO_DIAS = 7  # vencimiento de cuota dentro de N días → alerta

# Tipos notificables (incluye 'vencimiento', que es propio del motor —el front no lo muestra—).
TIPOS = ["tope", "recategorizacion", "ventana", "exclusion", "cuota", "vencimiento", "sync"]

# Defaults de la config del contador (espejo de src/data/configuracion.ts). Se usan cuando el contador
# nunca guardó algo. Los umbrales alimentan el cálculo; `notificaciones` gobierna el envío.
UMBRALES_DEFAULT = {
    "inflacionMensualProyeccion": 0.02,
    "umbralAmarilloPorcentaje": 0.80,
    "umbralAmarilloDias": 45,
    "umbralRojoDias": 15,
    "umbralRatioGastosAmarillo": 0.70,
    "umbralDeudaCuotaUrgente": 0.10,
}
NOTIF_DEFAULT = {
    "activo": False,
    "horaDesde": 9,
    "horaHasta": 21,
    "tipos": list(TIPOS),
}

_MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12,
}
_MES_NOMBRE = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _parse_fecha_ar(s: str | None) -> dt.date | None:
    """Parsea 'dd-mmm-aaaa' en español (ej. '10-jun-2026') como devuelve el portal Monotributo."""
    if not s:
        return None
    m = re.match(r"\s*(\d{1,2})-([a-zA-Z]+)-(\d{4})", s)
    if not m:
        return None
    mes = _MESES.get(m.group(2).lower()[:3])
    if not mes:
        return None
    try:
        return dt.date(int(m.group(3)), mes, int(m.group(1)))
    except ValueError:
        return None


def _money(v: float) -> str:
    return "$" + f"{v:,.0f}".replace(",", ".")  # formato AR: $1.234.567


def _pct(frac: float) -> str:
    return f"{round(frac * 100)}%"


def _fecha_larga(d: dt.date) -> str:
    return f"{d.day} de {_MES_NOMBRE[d.month]} de {d.year}"


def _ventanas_default(hoy: dt.date) -> list[dict]:
    """Ventanas de recategorización por defecto (5/8 y 5/2), espejo de ventanasRecategorizacion().
    Se usan cuando el contador no las editó a mano."""
    base = hoy.year
    candidatas: list[dict] = []
    for anio in range(base - 1, base + 3):
        candidatas.append({"fechaLimite": f"{anio}-08-05", "efectoDesde": f"{anio}-08-01"})
        candidatas.append({"fechaLimite": f"{anio + 1}-02-05", "efectoDesde": f"{anio + 1}-02-01"})
    hoy_iso = hoy.isoformat()
    futuras = sorted(
        (v for v in candidatas if v["fechaLimite"] >= hoy_iso), key=lambda v: v["fechaLimite"]
    )
    return futuras[:2]


def _config_efectiva(usuario: models.Usuario, hoy: dt.date) -> tuple[dict, dict, list[dict]]:
    """(notificaciones, umbrales, ventanas) efectivos del contador: lo guardado + defaults."""
    guardado = json.loads(usuario.config_json) if usuario.config_json else {}
    umbrales = {**UMBRALES_DEFAULT, **{k: v for k, v in guardado.items() if v is not None}}
    notif = {**NOTIF_DEFAULT, **(guardado.get("notificaciones") or {})}
    ventanas = guardado.get("ventanas") or _ventanas_default(hoy)
    return notif, umbrales, ventanas


def en_ventana_disponible(notif: dict, ahora_ar: dt.datetime) -> bool:
    """¿La hora actual (AR) cae en la franja en que el contador quiere recibir avisos?
    desde==hasta → todo el día. Soporta cruce de medianoche (ej. 22→6)."""
    desde, hasta = int(notif["horaDesde"]), int(notif["horaHasta"])
    if desde == hasta:
        return True
    h = ahora_ar.hour
    return desde <= h < hasta if desde < hasta else (h >= desde or h < hasta)


def derivar_alertas(cliente, calc: monotributo.CalculoCliente, umbrales: dict, hoy: dt.date) -> list[dict]:
    """Set completo de alertas de un cliente: [{tipo, severidad, texto}]. Espejo de derivarAlertas()."""
    out: list[dict] = []
    nombre = cliente.nombre

    def add(severidad: str, tipo: str, texto: str) -> None:
        out.append({"tipo": tipo, "severidad": severidad, "texto": f"{nombre}: {texto}"})

    # Falla de actualización de datos (vale para cualquier régimen).
    if cliente.resultado_ultima_extraccion == "fallida":
        add("datos", "sync", "no pudimos actualizar sus datos")

    if not calc.es_monotributista:
        return out  # RI / no monotributo: no aplican alertas de monotributo

    # Tope de facturación.
    pct = calc.porcentaje_tope_actual
    if pct >= 1:
        add("urgente", "tope", f"superó el tope de su categoría (facturó el {_pct(pct)} del tope anual)")
    elif pct >= umbrales["umbralAmarilloPorcentaje"]:
        add("aviso", "tope", f"cerca del tope ({_pct(pct)} de su categoría)")
    elif calc.fecha_proyectada_cruce_tope is not None:
        add(
            "aviso", "tope",
            f"al ritmo actual cruzaría el tope el {_fecha_larga(calc.fecha_proyectada_cruce_tope)}",
        )

    # Recategorización sugerida.
    if calc.categoria_norm and calc.categoria_corresponde != calc.categoria_norm:
        add("aviso", "recategorizacion", f"debería recategorizarse (le corresponde la Cat. {calc.categoria_corresponde})")

    # Ventana de recategorización próxima.
    dias = calc.dias_para_proxima_ventana
    if dias != float("inf") and calc.proxima_ventana is not None:
        d = int(dias)
        if d <= umbrales["umbralRojoDias"]:
            add("urgente", "ventana", f"cierra la ventana de recategorización en {d} días")
        elif d <= umbrales["umbralAmarilloDias"]:
            add("aviso", "ventana", f"se viene la recategorización (faltan {d} días)")

    # Riesgo de exclusión por gastos.
    if calc.ratio_superado_legal:
        add("urgente", "exclusion", f"riesgo de exclusión por gastos ({_pct(calc.ratio_gastos_tope_k)} del tope K)")
    elif calc.ratio_gastos_tope_k >= umbrales["umbralRatioGastosAmarillo"]:
        add("aviso", "exclusion", f"gastos altos ({_pct(calc.ratio_gastos_tope_k)} del tope K)")

    # Cuota del mes impaga (una deuda chica respecto de la cuota es aviso, no urgente).
    if cliente.cuota_estado == "con-deuda":
        deuda = float(cliente.cuota_deuda) if cliente.cuota_deuda is not None else 0.0
        cuota_mes = float(cliente.prox_venc_importe) if cliente.prox_venc_importe is not None else 0.0
        es_chica = cuota_mes > 0 and deuda > 0 and deuda < cuota_mes * umbrales["umbralDeudaCuotaUrgente"]
        if es_chica:
            add("aviso", "cuota", f"saldo pendiente en la cuota ({_money(deuda)}, {_pct(deuda / cuota_mes)} de la cuota del mes)")
        else:
            add("urgente", "cuota", f"cuota del mes impaga{f' (debe {_money(deuda)})' if deuda else ''}")

    # Vencimiento de cuota próximo (propio del motor; el front no lo muestra como alerta).
    venc = _parse_fecha_ar(cliente.prox_venc_fecha)
    if venc is not None:
        d = (venc - hoy).days
        if 0 <= d <= VENC_AVISO_DIAS:
            add("aviso", "vencimiento", f"vence la cuota el {cliente.prox_venc_fecha} (en {d} días)")

    return out


def _pasa_filtro(alerta: dict, notif: dict) -> bool:
    """¿La alerta entra según los temas que eligió el contador? Cada tema marcado se manda cuando
    aparece, sin importar la severidad (la importancia la transmite el texto de la alerta)."""
    return alerta["tipo"] in notif["tipos"]


def _clientes_out(db: Session, usuario_id: int) -> list:
    """Arma los ClienteOut del contador (mismos insumos que el dashboard). Import perezoso para no
    crear ciclo services→routers (routers/clientes importa services al cargar)."""
    from ..routers.clientes import construir_cliente_out

    clientes = db.scalars(
        select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == usuario_id)
    ).all()
    return [construir_cliente_out(db, c) for c in clientes]


def alertas_vigentes(db: Session, usuario: models.Usuario, hoy: dt.date | None = None) -> list[dict]:
    """Alertas vigentes del contador, YA filtradas por su config (tipos + nivel). Cada una con su
    `cuit`. No muta nada."""
    hoy = hoy or dt.date.today()
    notif, umbrales, ventanas = _config_efectiva(usuario, hoy)
    vigentes: list[dict] = []
    for cliente in _clientes_out(db, usuario.id):
        calc = monotributo.calcular_cliente(
            cliente, ventanas, umbrales["inflacionMensualProyeccion"], hoy
        )
        for a in derivar_alertas(cliente, calc, umbrales, hoy):
            if _pasa_filtro(a, notif):
                vigentes.append({**a, "cuit": cliente.cuit})
    return vigentes


def previsualizar(db: Session, usuario: models.Usuario) -> dict:
    """Vista previa para el contador logueado: qué alertas tiene hoy y cuáles serían NUEVAS (no
    avisadas aún), sin enviar ni persistir nada. Para QA del canal sin depender del proveedor."""
    hoy = dt.date.today()
    vigentes = alertas_vigentes(db, usuario, hoy)
    activos = db.scalars(
        select(models.AlertaEnviada).where(
            models.AlertaEnviada.usuario_id == usuario.id,
            models.AlertaEnviada.activa.is_(True),
        )
    ).all()
    claves_activas = {(a.cuit, a.tipo, a.severidad) for a in activos}
    nuevas = [a for a in vigentes if (a["cuit"], a["tipo"], a["severidad"]) not in claves_activas]
    return {"alertas": vigentes, "nuevas": nuevas, "total": len(vigentes), "nuevas_total": len(nuevas)}


def _mensaje(nuevas: list[dict]) -> str:
    lineas = "\n".join(f"• {a['texto']}" for a in nuevas)
    return (
        f"🔔 *Órbita* — {len(nuevas)} alerta(s) en tu cartera\n\n{lineas}\n\n"
        f"Entrá a Órbita para verlas en detalle."
    )


def evaluar_y_notificar(db: Session, solo_usuario_id: int | None = None) -> dict:
    """Por cada contador: calcula sus alertas vigentes (filtradas por su config), reconcilia el estado
    en `alertas_enviadas` y manda UN resumen con las NUEVAS por WhatsApp, si tiene el envío activo y
    está dentro de su ventana horaria. Devuelve un resumen agregado."""
    hoy = dt.date.today()
    ahora_ar = dt.datetime.now(_TZ_AR)
    q = select(models.Usuario)
    if solo_usuario_id is not None:
        q = q.where(models.Usuario.id == solo_usuario_id)
    usuarios = db.scalars(q).all()

    res = {"contadores_notificados": 0, "alertas_nuevas": 0, "mensajes_enviados": 0}
    for u in usuarios:
        if not u.telefono:
            continue
        notif, _, _ = _config_efectiva(u, hoy)
        vigentes = alertas_vigentes(db, u, hoy)

        activos = db.scalars(
            select(models.AlertaEnviada).where(
                models.AlertaEnviada.usuario_id == u.id,
                models.AlertaEnviada.activa.is_(True),
            )
        ).all()
        activos_por_clave = {(a.cuit, a.tipo, a.severidad): a for a in activos}
        claves_vigentes = {(a["cuit"], a["tipo"], a["severidad"]) for a in vigentes}

        # Reconciliación de estado (siempre, aunque no se envíe): re-armar las que se resolvieron.
        for clave, row in activos_por_clave.items():
            if clave not in claves_vigentes:
                row.activa = False
        db.commit()

        nuevas = [
            a for a in vigentes if (a["cuit"], a["tipo"], a["severidad"]) not in activos_por_clave
        ]
        res["alertas_nuevas"] += len(nuevas)

        # Envío: sólo si el contador lo activó, hay novedades y estamos en su ventana horaria.
        if not (notif["activo"] and nuevas and en_ventana_disponible(notif, ahora_ar)):
            continue
        try:
            sid = whatsapp.enviar_whatsapp(u.telefono, _mensaje(nuevas))
            if sid == "desactivado":
                # No hay proveedor configurado: no marcamos como enviadas (se mandarán cuando exista).
                continue
            for a in nuevas:
                db.add(
                    models.AlertaEnviada(
                        usuario_id=u.id, cuit=a["cuit"], tipo=a["tipo"],
                        severidad=a["severidad"], activa=True,
                    )
                )
            db.commit()
            res["contadores_notificados"] += 1
            res["mensajes_enviados"] += 1
        except Exception:  # noqa: BLE001 — best-effort: un fallo no frena al resto
            db.rollback()
            logger.warning("No se pudo notificar a %s", u.email, exc_info=True)

    return res
