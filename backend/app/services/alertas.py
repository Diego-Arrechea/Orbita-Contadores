"""
Motor de alertas del backend + notificación por WhatsApp.

Evalúa el set completo de alertas de cada cliente reusando el mismo cálculo que muestra la app
(`construir_cliente_out` + `monotributo.calcular_cliente` + `derivar_alertas`, espejo de
`src/lib/alertas.ts`). El criterio es POR TIPO y lo configura cada contador (config_json.alertas):
prende/apaga cada tipo, fija su umbral y, en los numéricos, cada cuánto % de subida se re-avisa.

"Solo lo nuevo" + anti-spam:
- **Baseline silencioso**: la 1ª vez que el motor ve un cliente (clientes_arca.alertas_baseline_en
  NULL) registra sus alertas vigentes como ya conocidas SIN enviar (foto del estado inicial). Así dar
  de alta un cliente —o encender el motor— no dispara el aluvión histórico.
- **Re-aviso por subida**: una alerta numérica se vuelve a avisar sólo si su valor sube respecto del
  último avisado por encima del umbral del tipo (alertas_enviadas.valor guarda ese valor).
- **Re-armado**: cuando una alerta se resuelve, su registro pasa a activa=False; si reaparece, vuelve
  a contar como nueva.
Clave de identidad: (usuario_id, cuit, tipo, severidad).
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

VENC_AVISO_DIAS_DEFAULT = 7

# Defaults POR TIPO (espejo de CONFIGURACION_INICIAL.alertas en src/data/configuracion.ts).
ALERTAS_DEFAULT = {
    "tope": {"activo": True, "avisarPct": 0.80, "proyeccionCruce": True, "reavisarSubidaPct": 0.10},
    "recategorizacion": {"activo": True},
    "ventana": {"activo": True, "avisoDias": 45, "urgenteDias": 15},
    "exclusion": {"activo": True, "avisarRatioPct": 0.70, "reavisarSubidaPct": 0.10},
    "cuota": {"activo": True, "urgenteDesdePct": 0.10, "reavisarSubidaPct": 0.10},
    "vencimiento": {"activo": True, "avisarDiasAntes": 7},
    "sync": {"activo": True},
}
NOTIF_DEFAULT = {"activo": False, "horaDesde": 9, "horaHasta": 21}
INFLACION_DEFAULT = 0.02

# Mapeo back-compat: umbrales globales VIEJOS → su campo en la config por tipo.
_UMBRAL_VIEJO = {
    "umbralAmarilloPorcentaje": ("tope", "avisarPct"),
    "umbralAmarilloDias": ("ventana", "avisoDias"),
    "umbralRojoDias": ("ventana", "urgenteDias"),
    "umbralRatioGastosAmarillo": ("exclusion", "avisarRatioPct"),
    "umbralDeudaCuotaUrgente": ("cuota", "urgenteDesdePct"),
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
    return "$" + f"{v:,.0f}".replace(",", ".")


def _pct(frac: float) -> str:
    return f"{round(frac * 100)}%"


def _fecha_larga(d: dt.date) -> str:
    return f"{d.day} de {_MES_NOMBRE[d.month]} de {d.year}"


def _ventanas_default(hoy: dt.date) -> list[dict]:
    """Ventanas de recategorización por defecto (5/8 y 5/2), espejo de ventanasRecategorizacion()."""
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


def _alertas_efectivas(guardado: dict) -> dict:
    """Config por tipo efectiva: defaults + mapeo de umbrales viejos (back-compat) + lo guardado nuevo."""
    cfg = {t: dict(v) for t, v in ALERTAS_DEFAULT.items()}
    for clave, (tipo, campo) in _UMBRAL_VIEJO.items():  # back-compat
        if isinstance(guardado.get(clave), (int, float)):
            cfg[tipo][campo] = guardado[clave]
    for tipo, sub in (guardado.get("alertas") or {}).items():  # forma nueva (gana)
        if tipo in cfg and isinstance(sub, dict):
            cfg[tipo].update({k: v for k, v in sub.items() if v is not None})
    return cfg


def _config_efectiva(usuario: models.Usuario) -> tuple[dict, dict, list[dict], float]:
    """(notif_canal, alertas_por_tipo, ventanas, inflacion) efectivos del contador."""
    guardado = json.loads(usuario.config_json) if usuario.config_json else {}
    notif = {**NOTIF_DEFAULT, **(guardado.get("notificaciones") or {})}
    alertas = _alertas_efectivas(guardado)
    ventanas = guardado.get("ventanas")  # None → se completa con default por cliente (hoy)
    inflacion = guardado.get("inflacionMensualProyeccion")
    inflacion = inflacion if isinstance(inflacion, (int, float)) else INFLACION_DEFAULT
    return notif, alertas, ventanas, inflacion


def en_ventana_disponible(notif: dict, ahora_ar: dt.datetime) -> bool:
    """¿La hora actual (AR) cae en la franja en que el contador quiere recibir avisos?"""
    desde, hasta = int(notif["horaDesde"]), int(notif["horaHasta"])
    if desde == hasta:
        return True
    h = ahora_ar.hour
    return desde <= h < hasta if desde < hasta else (h >= desde or h < hasta)


def _reaviso_step(tipo: str, alertas_cfg: dict) -> float:
    """Umbral de subida (fracción) para re-avisar una alerta numérica; 0 = no aplica."""
    return float(alertas_cfg.get(tipo, {}).get("reavisarSubidaPct", 0) or 0)


def derivar_alertas(cliente, calc: monotributo.CalculoCliente, a: dict, hoy: dt.date) -> list[dict]:
    """Set completo de alertas de un cliente según el criterio por tipo `a`. Cada alerta lleva
    {tipo, severidad, texto, valor}; `valor` es la magnitud (para el re-aviso) o None si es binaria.
    Espejo de derivarAlertas() del front (mismos umbrales). NO filtra por `activo` (eso es del envío)."""
    out: list[dict] = []
    nombre = cliente.nombre

    def add(severidad: str, tipo: str, texto: str, valor: float | None = None) -> None:
        out.append({"tipo": tipo, "severidad": severidad, "texto": f"{nombre}: {texto}", "valor": valor})

    if cliente.resultado_ultima_extraccion == "fallida":
        add("datos", "sync", "no pudimos actualizar sus datos")

    if not calc.es_monotributista:
        return out

    # Tope.
    pct = calc.porcentaje_tope_actual
    if pct >= 1:
        add("urgente", "tope", f"superó el tope de su categoría (facturó el {_pct(pct)} del tope anual)", pct)
    elif pct >= a["tope"]["avisarPct"]:
        add("aviso", "tope", f"cerca del tope ({_pct(pct)} de su categoría)", pct)
    elif a["tope"].get("proyeccionCruce", True) and calc.fecha_proyectada_cruce_tope is not None:
        add("aviso", "tope", f"al ritmo actual cruzaría el tope el {_fecha_larga(calc.fecha_proyectada_cruce_tope)}", pct)

    # Recategorización.
    if calc.categoria_norm and calc.categoria_corresponde != calc.categoria_norm:
        add("aviso", "recategorizacion", f"debería recategorizarse (le corresponde la Cat. {calc.categoria_corresponde})")

    # Ventana de recategorización.
    dias = calc.dias_para_proxima_ventana
    if dias != float("inf") and calc.proxima_ventana is not None:
        d = int(dias)
        if d <= a["ventana"]["urgenteDias"]:
            add("urgente", "ventana", f"cierra la ventana de recategorización en {d} días")
        elif d <= a["ventana"]["avisoDias"]:
            add("aviso", "ventana", f"se viene la recategorización (faltan {d} días)")

    # Gastos / exclusión.
    ratio = calc.ratio_gastos_tope_k
    if calc.ratio_superado_legal:
        add("urgente", "exclusion", f"riesgo de exclusión por gastos ({_pct(ratio)} del tope K)", ratio)
    elif ratio >= a["exclusion"]["avisarRatioPct"]:
        add("aviso", "exclusion", f"gastos altos ({_pct(ratio)} del tope K)", ratio)

    # Cuota impaga.
    if cliente.cuota_estado == "con-deuda":
        deuda = float(cliente.cuota_deuda) if cliente.cuota_deuda is not None else 0.0
        cuota_mes = float(cliente.prox_venc_importe) if cliente.prox_venc_importe is not None else 0.0
        ratio_cuota = deuda / cuota_mes if cuota_mes > 0 else None
        es_chica = cuota_mes > 0 and deuda > 0 and deuda < cuota_mes * a["cuota"]["urgenteDesdePct"]
        if es_chica:
            add("aviso", "cuota", f"saldo pendiente en la cuota ({_money(deuda)}, {_pct(ratio_cuota)} de la cuota del mes)", ratio_cuota)
        else:
            add("urgente", "cuota", f"cuota del mes impaga{f' (debe {_money(deuda)})' if deuda else ''}", ratio_cuota)

    # Vencimiento de cuota próximo.
    venc = _parse_fecha_ar(cliente.prox_venc_fecha)
    if venc is not None:
        d = (venc - hoy).days
        if 0 <= d <= int(a["vencimiento"].get("avisarDiasAntes", VENC_AVISO_DIAS_DEFAULT)):
            add("aviso", "vencimiento", f"vence la cuota el {cliente.prox_venc_fecha} (en {d} días)")

    return out


def _vigentes_de_cliente(
    db: Session, cliente_orm, alertas_cfg: dict, ventanas: list[dict], inflacion: float, hoy: dt.date
) -> list[dict]:
    """Alertas vigentes de un cliente, ya filtradas por los tipos ACTIVOS del contador. Import perezoso
    de construir_cliente_out para no crear ciclo services→routers."""
    from ..routers.clientes import construir_cliente_out

    cliente_out = construir_cliente_out(db, cliente_orm)
    vts = ventanas if ventanas else _ventanas_default(hoy)
    calc = monotributo.calcular_cliente(cliente_out, vts, inflacion, hoy)
    out = []
    for al in derivar_alertas(cliente_out, calc, alertas_cfg, hoy):
        if alertas_cfg.get(al["tipo"], {}).get("activo", True):
            out.append({**al, "cuit": cliente_out.cuit})
    return out


def alertas_vigentes(db: Session, usuario: models.Usuario, hoy: dt.date | None = None) -> list[dict]:
    """Todas las alertas vigentes del contador (filtradas por su config). No muta nada."""
    hoy = hoy or dt.date.today()
    _, alertas_cfg, ventanas, inflacion = _config_efectiva(usuario)
    clientes = db.scalars(
        select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == usuario.id)
    ).all()
    out: list[dict] = []
    for c in clientes:
        out.extend(_vigentes_de_cliente(db, c, alertas_cfg, ventanas, inflacion, hoy))
    return out


def previsualizar(db: Session, usuario: models.Usuario) -> dict:
    """Vista previa: qué alertas tiene hoy y cuáles serían NUEVAS, sin enviar ni persistir."""
    vigentes = alertas_vigentes(db, usuario)
    activos = db.scalars(
        select(models.AlertaEnviada).where(
            models.AlertaEnviada.usuario_id == usuario.id,
            models.AlertaEnviada.activa.is_(True),
        )
    ).all()
    claves = {(x.cuit, x.tipo, x.severidad) for x in activos}
    nuevas = [a for a in vigentes if (a["cuit"], a["tipo"], a["severidad"]) not in claves]
    return {"alertas": vigentes, "nuevas": nuevas, "total": len(vigentes), "nuevas_total": len(nuevas)}


def _mensaje(nuevas: list[dict]) -> str:
    lineas = "\n".join(f"• {a['texto']}" for a in nuevas)
    return (
        f"🔔 *Órbita* — {len(nuevas)} alerta(s) en tu cartera\n\n{lineas}\n\n"
        f"Entrá a Órbita para verlas en detalle."
    )


def evaluar_y_notificar(db: Session, solo_usuario_id: int | None = None) -> dict:
    """Por cada contador con el canal activo: baseline silencioso de clientes nuevos, deltas
    (nuevas + re-aviso por subida) y re-armado; manda UN resumen con lo nuevo si está en su ventana."""
    hoy = dt.date.today()
    ahora = dt.datetime.now(dt.timezone.utc)
    ahora_ar = dt.datetime.now(_TZ_AR)
    q = select(models.Usuario)
    if solo_usuario_id is not None:
        q = q.where(models.Usuario.id == solo_usuario_id)
    usuarios = db.scalars(q).all()

    res = {"contadores_notificados": 0, "alertas_nuevas": 0, "mensajes_enviados": 0}
    for u in usuarios:
        if not u.telefono:
            continue
        notif, alertas_cfg, ventanas, inflacion = _config_efectiva(u)
        if not notif["activo"]:
            continue  # canal apagado: no se baselinea ni se trackea (se hará al activar)

        clientes = db.scalars(
            select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == u.id)
        ).all()
        activos = db.scalars(
            select(models.AlertaEnviada).where(
                models.AlertaEnviada.usuario_id == u.id, models.AlertaEnviada.activa.is_(True)
            )
        ).all()
        por_clave = {(x.cuit, x.tipo, x.severidad): x for x in activos}
        claves_vigentes: set = set()
        nuevas: list[dict] = []

        for c in clientes:
            vigentes = _vigentes_de_cliente(db, c, alertas_cfg, ventanas, inflacion, hoy)
            for a in vigentes:
                claves_vigentes.add((a["cuit"], a["tipo"], a["severidad"]))
            if c.alertas_baseline_en is None:
                # Baseline silencioso: registra el estado actual como conocido, NO envía.
                for a in vigentes:
                    db.add(models.AlertaEnviada(
                        usuario_id=u.id, cuit=a["cuit"], tipo=a["tipo"], severidad=a["severidad"],
                        activa=True, valor=a["valor"],
                    ))
                c.alertas_baseline_en = ahora
                continue
            for a in vigentes:
                clave = (a["cuit"], a["tipo"], a["severidad"])
                rec = por_clave.get(clave)
                if rec is None:
                    nuevas.append(a)  # apareció después del baseline
                else:
                    step = _reaviso_step(a["tipo"], alertas_cfg)
                    if step and a["valor"] is not None and rec.valor is not None and \
                            float(a["valor"]) >= float(rec.valor) + step:
                        nuevas.append({**a, "_rec": rec})  # empeoró lo suficiente → re-aviso

        # Re-armado: lo que ya no está vigente vuelve a quedar disponible para futuros avisos.
        for clave, rec in por_clave.items():
            if clave not in claves_vigentes:
                rec.activa = False
        db.commit()  # persiste baseline + re-armado (corre aunque no se envíe)

        res["alertas_nuevas"] += len(nuevas)
        if not (nuevas and en_ventana_disponible(notif, ahora_ar)):
            continue
        try:
            sid = whatsapp.enviar_whatsapp(u.telefono, _mensaje(nuevas))
            if sid == "desactivado":
                continue  # sin proveedor: no marcamos enviado (se mandará cuando exista)
            for a in nuevas:
                rec = a.get("_rec")
                if rec is not None:
                    rec.valor = a["valor"]  # re-aviso: actualiza la marca de agua
                else:
                    db.add(models.AlertaEnviada(
                        usuario_id=u.id, cuit=a["cuit"], tipo=a["tipo"], severidad=a["severidad"],
                        activa=True, valor=a["valor"],
                    ))
            db.commit()
            res["contadores_notificados"] += 1
            res["mensajes_enviados"] += 1
        except Exception:  # noqa: BLE001 — best-effort: un fallo no frena al resto
            db.rollback()
            logger.warning("No se pudo notificar a %s", u.email, exc_info=True)

    return res
