"""Reporte del cliente armado en el BACKEND, para los envíos programados (nadie mira la pantalla a la
hora del envío, así que el reporte se calcula acá con los datos de ese momento).

ES UN ESPEJO del front y tiene que dar EXACTAMENTE lo mismo que la pantalla del reporte y el mail
"Enviar ahora". Fuentes, por orden:
  src/services/clientesService.ts  construirCliente  → `armar_cliente`
  src/lib/derivarHistorial.ts                         → `_derivar_historial`
  src/lib/monotributo.ts           calcularCliente    → `calcular`
  src/lib/alertas.ts               derivarAlertas     → `derivar_alertas`
  src/lib/reporteCliente.ts        accionesSugeridas  → `acciones_sugeridas`
  src/lib/reporteDatos.ts          (todo)             → `situacion_periodo`, `armar_datos`
  src/lib/reporteMail.ts           armarMailReporte   → `armar_mail`
  src/lib/utils.ts                 formatos           → `fmt_*`
Si cambiás uno de esos archivos, cambiá el espejo acá (y corré la comparación de
`scripts/comparar_reporte_auto.py`).

No se reutilizan `services/monotributo.calcular_cliente` ni `services/alertas.derivar_alertas`: son
espejos parciales para el motor de avisos y difieren del front (carga manual, agro, textos).
"""
from __future__ import annotations

import datetime as dt
import html as html_lib
import json
import math
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..data import categorias as cats
from ..schemas import nombre_tipo

TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
MESES_LARGOS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

# ── Formatos (idénticos a los de src/lib/utils.ts con Intl es-AR) ──────────────────────────────


def _redondear(x: float, decimales: int) -> Decimal:
    """Redondeo de `Number.toFixed` / Intl: sobre el valor binario exacto, mitades hacia afuera."""
    return Decimal(x).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP)


def _miles(entero: int) -> str:
    return f"{entero:,}".replace(",", ".")


def fmt_currency(v: float) -> str:
    """formatCurrency(v): '$ 1.234' (espacio duro, sin decimales; negativos '-$ 1.234')."""
    neg = v < 0 or (v == 0 and math.copysign(1, v) < 0)
    n = int(_redondear(abs(v), 0))
    return f"{'-' if neg else ''}$ {_miles(n)}"


def fmt_percent(v: float, decimales: int = 0) -> str:
    """formatPercent(v, d): (v*100).toFixed(d) con coma decimal."""
    x = v * 100
    s = format(_redondear(abs(x), decimales), "f")
    if x < 0:  # toFixed de un negativo: "-" + toFixed(-x), aunque redondee a 0 ("-0")
        s = "-" + s
    return s.replace(".", ",") + "%"


def fmt_cuit(cuit: str) -> str:
    limpio = "".join(ch for ch in str(cuit) if ch.isdigit())
    if len(limpio) != 11:
        return str(cuit)
    return f"{limpio[:2]}-{limpio[2:10]}-{limpio[10:]}"


def _a_fecha(valor: str | dt.date | dt.datetime) -> dt.date:
    """aDate del front: 'aaaa-mm-dd' = fecha local; un ISO con hora se pasa a hora de Argentina."""
    if isinstance(valor, dt.datetime):
        return (valor.astimezone(TZ_AR) if valor.tzinfo else valor).date()
    if isinstance(valor, dt.date):
        return valor
    s = str(valor)
    if len(s) == 10:
        return dt.date.fromisoformat(s)
    d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return (d.astimezone(TZ_AR) if d.tzinfo else d).date()


def fmt_fecha(valor, formato: str = "short") -> str:
    d = _a_fecha(valor)
    if formato == "long":
        return f"{d.day:02d} de {MESES_LARGOS[d.month - 1]} de {d.year}"
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def esc(s: Any) -> str:
    return (
        str("" if s is None else s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


# ── Cliente (espejo de construirCliente, sólo los campos que usa el reporte) ───────────────────


def _idx_mes(mes: str) -> int:
    y, m = mes[:7].split("-")
    return int(y) * 12 + int(m) - 1


def _idx_fecha(d: dt.date) -> int:
    return d.year * 12 + d.month - 1


def _mes_corto(idx: int) -> str:
    return f"{MESES_CORTOS[idx % 12]} {idx // 12}"


def _derivar_historial(comprobantes: list[dict]) -> list[dict]:
    por_mes: dict[str, dict[str, float]] = {}
    for c in comprobantes:
        mes = c["fechaEmision"][:7]
        e = por_mes.setdefault(mes, {"brutas": 0.0, "nc": 0.0, "recibidas": 0.0, "ncRecibidas": 0.0})
        es_nc = "Nota Crédito" in c["tipo"]
        if c["direccion"] == "emitido":
            e["nc" if es_nc else "brutas"] += c["monto"]
        elif c["direccion"] == "recibido":
            e["ncRecibidas" if es_nc else "recibidas"] += c["monto"]
    out = []
    for mes in sorted(por_mes):
        e = por_mes[mes]
        rec = e["recibidas"] - e["ncRecibidas"]
        out.append({
            "mes": mes,
            "emitidasNetas": e["brutas"] - e["nc"],
            "recibidas": rec,
            "recibidasComputables": rec,
            "ingresosNoFacturados": 0.0,
        })
    return out


def _ventana_12(historial: list[dict], hoy: dt.date) -> list[dict]:
    fin = _idx_fecha(hoy)
    return [m for m in historial if fin - 11 <= _idx_mes(m["mes"]) <= fin]


def armar_cliente(db: Session, c: models.ClienteARCA) -> SimpleNamespace:
    """El `Cliente` del front para el reporte: mismo ClienteOut que la ficha + TODOS los comprobantes
    (el historial se deriva de ellos, como en getClienteReal)."""
    from ..routers.clientes import construir_cliente_out  # import tardío: evita el ciclo con el router

    bk = construir_cliente_out(db, c, meses_historial=26).model_dump()
    filas = db.scalars(
        select(models.ComprobanteEmitido)
        .where(models.ComprobanteEmitido.cuit == c.cuit)
        .order_by(models.ComprobanteEmitido.fecha.desc())
    ).all()
    comprobantes = [
        {
            "direccion": f.direccion,
            "tipo": nombre_tipo(f.cbte_tipo),
            "fechaEmision": f.fecha.isoformat(),
            "monto": float(f.imp_total),
            "origen": f.origen or "arca",
        }
        for f in filas
    ]
    if comprobantes or not bk.get("historial_mensual"):
        historial = _derivar_historial(comprobantes)
    else:
        historial = [
            {
                "mes": h["mes"],
                "emitidasNetas": h["emitidasNetas"],
                "recibidas": h["recibidas"],
                "recibidasComputables": h["recibidasComputables"],
                "ingresosNoFacturados": h.get("ingresosNoFacturados") or 0.0,
            }
            for h in bk["historial_mensual"]
        ]
    hoy = dt.datetime.now(TZ_AR).date()
    fact12 = sum(m["emitidasNetas"] for m in _ventana_12(historial, hoy))
    primer_mes = historial[0]["mes"] if historial else None
    codigos = [k.codigo for k in cats.CATEGORIAS]
    cat_real = bk.get("categoria") if bk.get("categoria") in codigos else None
    reg = bk.get("regimen")
    if reg in ("monotributo", "responsable_inscripto", "no_monotributo"):
        regimen = reg
    else:
        regimen = "monotributo" if cat_real else "pendiente"
    categoria = (cat_real or cats.inferir_categoria(fact12)) if regimen == "monotributo" else None
    actividad = bk.get("actividad") if bk.get("actividad") in ("comercio", "servicios") else "servicios"
    return SimpleNamespace(
        id=bk["cuit"],
        cuit=bk["cuit"],
        nombre=bk["nombre"],
        regimen=regimen,
        categoria=categoria,
        tipoActividad=actividad,
        fechaInicio=bk.get("fecha_inicio") or (f"{primer_mes}-01" if primer_mes else "2020-01-01"),
        historialMensual=historial,
        comprobantes=comprobantes,
        resultadoUltimaExtraccion=bk.get("resultado_ultima_extraccion") or "pendiente",
        motivoFalloUltimaExtraccion=bk.get("motivo_ultima_extraccion"),
        estadoCuotaMesActual="con-deuda" if bk.get("cuota_estado") == "con-deuda" else "al-dia",
        cuotaDeuda=bk.get("cuota_deuda"),
        cuotaSaldoFavor=bk.get("cuota_saldo_favor"),
        proxVencFecha=bk.get("prox_venc_fecha"),
        proxVencImporte=bk.get("prox_venc_importe"),
        mesesAdeudados=bk.get("meses_adeudados"),
        comunicacionesSinVer=bk.get("comunicaciones_sin_ver") or 0,
        facturacion12mOficial=bk.get("facturacion_12m"),
        topeCategoriaOficial=bk.get("tope_categoria"),
        facturometroActualizado=bk.get("facturometro_actualizado"),
        ventanaRecatHasta=bk.get("recat_ventana_hasta"),
        facturacionAgro12m=bk.get("facturacion_agro_12m") or 0,
        emailCliente=bk.get("email_cliente"),
        reporteConfig=bk.get("reporte_config"),
    )


# ── Configuración del contador (espejo de combinar() en ConfigContext.tsx) ─────────────────────

REPORTE_DEFAULT = {
    "secciones": {"situacion": True, "historial": True, "alertas": True, "movimientos": True, "acciones": True},
    "metricas": {
        "facturacion12m": True, "topeCategoria": True, "topeConsumido": True, "margenMensual": True,
        "cuotaMes": True, "estadoCuota": True, "proximoVencimiento": True, "deudaCuota": True,
        "mesesAdeudados": True, "saldoFavor": True,
    },
    "mesesHistorial": 12,
    "periodoSituacion": "recategorizacion",
    "mesesSituacion": [],
}


def _ventanas_default(hoy: dt.date) -> list[dict]:
    """ventanasRecategorizacion(): las próximas dos (5/8 y 5/2), con su semestre."""
    cands = []
    for anio in range(hoy.year - 1, hoy.year + 3):
        cands.append({"semestre": "Enero-Junio", "fechaLimite": f"{anio}-08-05"})
        cands.append({"semestre": "Julio-Diciembre", "fechaLimite": f"{anio + 1}-02-05"})
    futuras = sorted((v for v in cands if v["fechaLimite"] >= hoy.isoformat()), key=lambda v: v["fechaLimite"])
    return futuras[:2]


def config_usuario(usuario: models.Usuario, hoy: dt.date) -> dict:
    from .alertas import _alertas_efectivas  # mismo merge de umbrales que combinar()

    guardado = json.loads(usuario.config_json) if usuario.config_json else {}
    limpio = {k: v for k, v in guardado.items() if v is not None}
    rg = limpio.get("reporte") or {}
    ps = rg.get("periodoSituacion")
    ms = rg.get("mesesSituacion")
    reporte = {
        "secciones": {**REPORTE_DEFAULT["secciones"], **(rg.get("secciones") or {})},
        "metricas": {**REPORTE_DEFAULT["metricas"], **(rg.get("metricas") or {})},
        "mesesHistorial": rg["mesesHistorial"]
        if isinstance(rg.get("mesesHistorial"), (int, float)) and not isinstance(rg.get("mesesHistorial"), bool)
        else 12,
        "periodoSituacion": ps if ps in ("meses", "siguiente") else "recategorizacion",
        "mesesSituacion": [m for m in ms if isinstance(m, str)] if isinstance(ms, list) else [],
    }
    return {
        "alertas": _alertas_efectivas(limpio),
        "ventanas": limpio.get("ventanas") or _ventanas_default(hoy),
        "reporte": reporte,
    }


def opciones_reporte(general: dict, propias: dict | None) -> dict:
    if not propias:
        return general
    return {
        "secciones": {**general["secciones"], **(propias.get("secciones") or {})},
        "metricas": {**general["metricas"], **(propias.get("metricas") or {})},
        "mesesHistorial": propias["mesesHistorial"]
        if propias.get("mesesHistorial") is not None else general["mesesHistorial"],
        "periodoSituacion": propias.get("periodoSituacion") or general["periodoSituacion"],
        "mesesSituacion": propias.get("mesesSituacion")
        if propias.get("mesesSituacion") is not None else general["mesesSituacion"],
    }


# ── Cálculo (espejo de calcularCliente, los campos que usa el reporte) ─────────────────────────


@dataclass
class Calc:
    facturacionUltimos12: float
    porcentajeTopeActual: float
    categoriaCorresponde: cats.Categoria
    ratioGastosTopeCatK: float
    ratioUmbralLegal: float
    ratioSuperadoLegal: bool
    fechaProyectadaCruceTope: dt.date | None
    diasParaProximaVentana: float
    proximaVentana: dict | None
    nivelTope: float
    topeReferencia: float


def _set_month_js(d: dt.date, meses: int) -> dt.date:
    """Date.setMonth(m + n): si el día no existe en el mes destino, desborda al siguiente."""
    idx = d.year * 12 + d.month - 1 + meses
    y, m = divmod(idx, 12)
    primero = dt.date(y, m + 1, 1)
    return primero + dt.timedelta(days=d.day - 1)


def _proyectar_cruce(acum12: float, mensuales: list[float], prom: float, variacion: float, tope: float, hoy: dt.date):
    if acum12 >= tope:
        return None
    acum = acum12
    ventana = list(mensuales)
    fecha = hoy
    for _ in range(12):
        fecha = _set_month_js(fecha, 1)
        prom = prom * (1 + max(-0.1, min(variacion, 0.2)))
        sale = ventana.pop(0) if ventana else 0
        ventana.append(prom)
        acum += prom - sale
        if acum >= tope:
            return fecha
    return None


def calcular(cliente: SimpleNamespace, ventanas_config: list[dict], hoy: dt.date) -> Calc:
    ult12 = _ventana_12(cliente.historialMensual, hoy)
    agro = cliente.facturacionAgro12m or 0
    fact12 = sum(m["emitidasNetas"] + m["ingresosNoFacturados"] for m in ult12) + agro
    compras12 = sum(m["recibidasComputables"] for m in ult12)
    inicio = dt.date.fromisoformat(cliente.fechaInicio[:10])
    meses_act = max(1, math.floor((hoy - inicio).days / 30))
    meses_ef = min(12, meses_act)
    anualizada = fact12 / meses_ef * 12 if meses_ef < 12 else fact12
    cat_actual = cats.get_categoria(cliente.categoria)
    oficial_ok = cliente.facturacion12mOficial is not None and cliente.facturacion12mOficial > 0
    tope_of_ok = cliente.topeCategoriaOficial is not None and cliente.topeCategoriaOficial > 0
    fin = _idx_fecha(hoy)
    manual12 = 0.0
    for c in cliente.comprobantes:
        if c["origen"] != "manual" or c["direccion"] != "emitido":
            continue
        if fin - 11 <= _idx_mes(c["fechaEmision"]) <= fin:
            manual12 += (-1 if "Nota Crédito" in c["tipo"] else 1) * c["monto"]
    nivel = cliente.facturacion12mOficial + manual12 if oficial_ok else anualizada
    tope_ref = cliente.topeCategoriaOficial if tope_of_ok else cat_actual.tope_anual
    pct = nivel / tope_ref if tope_ref > 0 else 0
    corresponde = next((k for k in cats.CATEGORIAS if nivel <= k.tope_anual), cats.CATEGORIAS[-1])
    ratio_k = compras12 / cats.tope_categoria_k()
    umbral = cats.RATIO_GASTOS_COMERCIO if cliente.tipoActividad == "comercio" else cats.RATIO_GASTOS_SERVICIOS
    ult3 = ult12[-3:]
    ant3 = ult12[-6:-3]
    prom_ult3 = sum(m["emitidasNetas"] + m["ingresosNoFacturados"] for m in ult3) / 3
    prom_ant3 = sum(m["emitidasNetas"] + m["ingresosNoFacturados"] for m in ant3) / 3 or prom_ult3
    variacion = (prom_ult3 - prom_ant3) / prom_ant3 / 3 if prom_ant3 > 0 else 0
    proyectada = _proyectar_cruce(
        cliente.facturacion12mOficial + manual12 if oficial_ok else fact12,
        [m["emitidasNetas"] + m["ingresosNoFacturados"] for m in ult12],
        prom_ult3,
        variacion,
        tope_ref,
        hoy,
    )
    if cliente.ventanaRecatHasta:
        h = cliente.ventanaRecatHasta
        mes = int(h[5:7])
        real = {"semestre": "Julio-Diciembre" if 1 <= mes <= 3 else "Enero-Junio", "fechaLimite": h}
        efectivas = [real] + [v for v in ventanas_config if v["fechaLimite"] > h]
    else:
        efectivas = ventanas_config
    futuras = sorted(
        (
            {**v, "dias": (dt.date.fromisoformat(v["fechaLimite"][:10]) - hoy).days}
            for v in efectivas
        ),
        key=lambda v: v["dias"],
    )
    futuras = [v for v in futuras if v["dias"] >= 0]
    proxima = futuras[0] if futuras else None
    return Calc(
        facturacionUltimos12=fact12,
        porcentajeTopeActual=pct,
        categoriaCorresponde=corresponde,
        ratioGastosTopeCatK=ratio_k,
        ratioUmbralLegal=umbral,
        ratioSuperadoLegal=ratio_k > umbral,
        fechaProyectadaCruceTope=proyectada,
        diasParaProximaVentana=proxima["dias"] if proxima else math.inf,
        proximaVentana=proxima,
        nivelTope=nivel,
        topeReferencia=tope_ref,
    )


def _es_mono(cliente) -> bool:
    return cliente.regimen is None or cliente.regimen == "monotributo"


def etiqueta_regimen(regimen: str | None) -> str:
    return {
        "responsable_inscripto": "Responsable Inscripto",
        "no_monotributo": "No monotributista",
        "pendiente": "Datos en proceso",
    }.get(regimen or "", "Monotributo")


# ── Alertas y acciones (espejo de alertas.ts / reporteCliente.ts) ──────────────────────────────

_PRIORIDAD = {"urgente": 0, "aviso": 1, "datos": 2, "ok": 3}


def derivar_alertas(cliente, calc: Calc, alertas_cfg: dict) -> list[dict]:
    out: list[dict] = []

    def add(sev: str, titulo: str, detalle: str) -> None:
        out.append({"severidad": sev, "titulo": titulo, "detalle": detalle})

    if cliente.resultadoUltimaExtraccion == "fallida":
        add("datos", "La sincronización con ARCA falló",
            cliente.motivoFalloUltimaExtraccion or "No se pudieron traer los últimos datos.")
    dfe = cliente.comunicacionesSinVer or 0
    if dfe > 0:
        cuantas = "1 comunicación nueva" if dfe == 1 else f"{dfe} comunicaciones nuevas"
        add("aviso",
            "Comunicación nueva en el Domicilio Fiscal Electrónico" if dfe == 1
            else "Comunicaciones nuevas en el Domicilio Fiscal Electrónico",
            f"Tiene {cuantas} en su Domicilio Fiscal Electrónico.")
    if not _es_mono(cliente):
        return out
    pct = calc.porcentajeTopeActual
    if pct >= 1:
        add("urgente", "Superó el tope de su categoría",
            f"Facturó el {fmt_percent(pct, 0)} del tope anual. Riesgo de exclusión.")
    elif pct >= alertas_cfg["tope"]["avisarPct"]:
        add("aviso", "Cerca del tope", f"Lleva el {fmt_percent(pct, 0)} del tope de su categoría.")
    elif alertas_cfg["tope"].get("proyeccionCruce") and calc.fechaProyectadaCruceTope:
        add("aviso", "Proyección de cruce de tope",
            f"Al ritmo actual cruzaría el tope el {fmt_fecha(calc.fechaProyectadaCruceTope, 'long')}.")
    debe = bool(cliente.categoria) and calc.categoriaCorresponde.codigo != cliente.categoria
    if debe:
        add("aviso", "Debería recategorizarse",
            f"Por su facturación le corresponde la Cat. {calc.categoriaCorresponde.codigo}.")
    dias = calc.diasParaProximaVentana
    if debe and math.isfinite(dias) and calc.proximaVentana:
        if dias <= alertas_cfg["ventana"]["urgenteDias"]:
            add("urgente", "Cierra la ventana de recategorización",
                f"Faltan {dias} días (vence el {fmt_fecha(calc.proximaVentana['fechaLimite'], 'long')}).")
        elif dias <= alertas_cfg["ventana"]["avisoDias"]:
            add("aviso", "Se viene la recategorización", f"Faltan {dias} días para la próxima ventana.")
    if calc.ratioSuperadoLegal:
        add("urgente", "Riesgo de exclusión por gastos",
            f"Sus compras son el {fmt_percent(calc.ratioGastosTopeCatK, 0)} del tope K "
            f"(supera el {fmt_percent(calc.ratioUmbralLegal, 0)} permitido).")
    elif calc.ratioGastosTopeCatK >= alertas_cfg["exclusion"]["avisarRatioPct"]:
        add("aviso", "Gastos altos", f"Sus compras son el {fmt_percent(calc.ratioGastosTopeCatK, 0)} del tope K.")
    if cliente.estadoCuotaMesActual == "con-deuda":
        deuda = cliente.cuotaDeuda or 0
        cuota_mes = cliente.proxVencImporte or 0
        chica = cuota_mes > 0 and deuda > 0 and deuda < cuota_mes * alertas_cfg["cuota"]["urgenteDesdePct"]
        if chica:
            add("aviso", "Saldo pendiente en la cuota",
                f"Adeuda {fmt_currency(deuda)} ({fmt_percent(deuda / cuota_mes, 0)} de la cuota del mes).")
        else:
            add("aviso", "Cuota del mes impaga",
                f"Adeuda {fmt_currency(deuda)}." if deuda else "Tiene la cuota del mes con deuda.")
    meses = cliente.mesesAdeudados or 0
    if meses >= alertas_cfg["meses_adeudados"]["umbralMeses"]:
        add("urgente", f"Adeuda {meses} meses seguidos",
            f"Acumula {meses} meses seguidos de deuda en la cuota del monotributo.")
    return sorted(out, key=lambda a: _PRIORIDAD[a["severidad"]])  # sort estable, como el front


def acciones_sugeridas(cliente, calc: Calc, pendientes: int) -> list[str]:
    acc: list[str] = []
    mono = _es_mono(cliente)
    if mono and calc.porcentajeTopeActual >= 1:
        acc.append("Superó el tope anual: evaluar recategorización o cambio de régimen con urgencia.")
    elif mono and cliente.categoria and calc.categoriaCorresponde.codigo != cliente.categoria:
        acc.append(
            f"Recategorizar a Cat. {calc.categoriaCorresponde.codigo} "
            f"(tope {fmt_currency(calc.categoriaCorresponde.tope_anual)})."
        )
    if mono and cliente.estadoCuotaMesActual == "con-deuda":
        deuda = cliente.cuotaDeuda or 0
        meses = cliente.mesesAdeudados or 0
        arrastre = f" — arrastra {meses} meses seguidos" if meses >= 2 else ""
        acc.append(
            f"Regularizar la cuota del mes (adeuda {fmt_currency(deuda)}{arrastre})." if deuda > 0
            else f"Regularizar la cuota del mes impaga{arrastre}."
        )
    if mono and calc.ratioSuperadoLegal:
        acc.append("Revisar las compras: superan el umbral de gastos que habilita la exclusión.")
    if pendientes > 0:
        acc.append(
            f"Revisar {pendientes} {'movimiento pendiente' if pendientes == 1 else 'movimientos pendientes'} "
            "de respaldo fiscal."
        )
    if mono and math.isfinite(calc.diasParaProximaVentana) and calc.diasParaProximaVentana <= 30 and calc.proximaVentana:
        acc.append(f"Se acerca la ventana de recategorización (faltan {calc.diasParaProximaVentana} días).")
    if cliente.resultadoUltimaExtraccion == "fallida":
        acc.append("Reintentar la actualización de datos del cliente.")
    if not acc:
        acc.append("Sin acciones pendientes: el cliente está al día.")
    return acc


# ── Situación por período (espejo de reporteDatos.ts) ──────────────────────────────────────────


def _periodo_proxima_recat(proxima: dict | None, hoy: dt.date) -> int:
    """Índice del primer mes del período que evalúa la próxima recategorización."""
    if proxima:
        y, m = proxima["fechaLimite"][:7].split("-")
        return int(y) * 12 + int(m) - 1 - 13
    return (hoy.year - 1) * 12 + 6 if hoy.month - 1 < 6 else hoy.year * 12


def ventanas_abiertas(calc: Calc, hoy: dt.date) -> list[dict]:
    base = _periodo_proxima_recat(calc.proximaVentana, hoy)
    out = []
    for modo, desde in (("recategorizacion", base), ("siguiente", base + 6)):
        recat = desde + 12
        out.append({
            "modo": modo,
            "desdeIdx": desde,
            "etiqueta": f"Desde {_mes_corto(desde)} (recategorización de {MESES_LARGOS[recat % 12]} {recat // 12})",
        })
    return out


def _idx_corte(corte: str | None) -> int | None:
    if not corte or len(corte) != 10 or corte[2] != "/" or corte[5] != "/":
        return None
    try:
        return int(corte[6:]) * 12 + int(corte[3:5]) - 1
    except ValueError:
        return None


def situacion_periodo(cliente, calc: Calc, modo: str, meses_elegidos: list[str], hoy: dt.date) -> dict:
    tope = calc.topeReferencia
    neto = lambda m: m["emitidasNetas"] + m["ingresosNoFacturados"]  # noqa: E731
    elegidos = set(meses_elegidos or [])
    del_hist = [m for m in cliente.historialMensual if m["mes"] in elegidos]
    if modo == "meses" and del_hist:
        idxs = sorted(_idx_mes(m["mes"]) for m in del_hist)
        n = len(idxs)
        contiguos = idxs[-1] - idxs[0] + 1 == n
        etiqueta = (
            _mes_corto(idxs[0]) if n == 1
            else f"{_mes_corto(idxs[0])} – {_mes_corto(idxs[-1])}" if contiguos
            else f"{n} meses elegidos"
        )
        facturado = sum(neto(m) for m in del_hist)
        restantes = max(0, 12 - n)
        return {
            "etiqueta": etiqueta,
            "facturado": facturado,
            "tope": tope,
            "porcentaje": facturado / tope if tope > 0 else 0,
            "mesesRestantes": restantes,
            "porMes": max(0, tope - facturado) / restantes if restantes > 0 else None,
            "nota": f"{n} {'mes elegido' if n == 1 else 'meses elegidos'}"
            + ("" if contiguos or n == 1 else f" entre {_mes_corto(idxs[0])} y {_mes_corto(idxs[-1])}")
            + ", según los comprobantes emitidos.",
        }
    abiertas = ventanas_abiertas(calc, hoy)
    ventana = next((v for v in abiertas if v["modo"] == modo), abiertas[0])
    desde = ventana["desdeIdx"]
    hasta = desde + 11
    hoy_idx = _idx_fecha(hoy)
    corte = _idx_corte(cliente.facturometroActualizado)
    oficial = (
        ventana["modo"] == "recategorizacion"
        and (cliente.facturacion12mOficial or 0) > 0
        and corte is not None
        and desde <= corte <= hasta
    )
    facturado = (
        calc.nivelTope if oficial
        else sum(neto(m) for m in cliente.historialMensual if desde <= _idx_mes(m["mes"]) <= hasta)
    )
    restantes = max(0, min(12, hasta - hoy_idx + 1))
    recat = hasta + 1
    return {
        "etiqueta": f"desde {_mes_corto(desde)}",
        "facturado": facturado,
        "tope": tope,
        "porcentaje": facturado / tope if tope > 0 else 0,
        "mesesRestantes": restantes,
        "porMes": max(0, tope - facturado) / restantes if restantes > 0 else None,
        "nota": f"Período de la recategorización de {MESES_LARGOS[recat % 12]} {recat // 12}: "
        f"{_mes_corto(desde)} a {_mes_corto(hasta)}. "
        + (
            f"Facturado según el facturómetro oficial al {cliente.facturometroActualizado}."
            if oficial else "Facturado según los comprobantes emitidos."
        ),
    }


@dataclass
class Datos:
    calc: Calc
    situacion: dict
    no_mono: bool
    debe_recategorizar: bool
    historial: list[dict]
    alertas: list[dict]
    pendientes: list[models.MovimientoBancario]
    acciones: list[str]
    metricas: list[dict] = field(default_factory=list)


def armar_datos(cliente, config: dict, movimientos: list, rep: dict, hoy: dt.date) -> Datos:
    calc = calcular(cliente, config["ventanas"], hoy)
    no_mono = not _es_mono(cliente)
    cat = cats.get_categoria(cliente.categoria)
    debe = not no_mono and calc.categoriaCorresponde.codigo != cliente.categoria
    # slice(-n) del front: con n = 0 devuelve todo (igual que [-0:] acá).
    historial = _ventana_12(cliente.historialMensual, hoy)[-int(rep["mesesHistorial"]):]
    alertas = derivar_alertas(cliente, calc, config["alertas"])
    pendientes = [m for m in movimientos if not m.comprobante_matcheado_id and not m.marcado_como]
    acciones = acciones_sugeridas(cliente, calc, len(pendientes))
    sit = situacion_periodo(cliente, calc, rep["periodoSituacion"], rep["mesesSituacion"], hoy)
    r = sit["mesesRestantes"]
    meses = cliente.mesesAdeudados or 0
    metricas = [] if no_mono else [
        {"key": "facturacion12m", "label": f"Facturado {sit['etiqueta']}", "valor": fmt_currency(sit["facturado"])},
        {"key": "topeCategoria", "label": "Tope de la categoría", "valor": fmt_currency(sit["tope"])},
        {"key": "topeConsumido", "label": "Tope consumido", "valor": fmt_percent(sit["porcentaje"], 1)},
        {
            "key": "margenMensual",
            "label": f"Puede facturar por mes ({r} {'mes restante' if r == 1 else 'meses restantes'})",
            "valor": None if sit["porMes"] is None
            else fmt_currency(sit["porMes"]) if sit["porMes"] > 0 else "Ya alcanzó el tope",
        },
        {
            "key": "cuotaMes",
            "label": "Cuota del mes",
            "valor": fmt_currency(
                cliente.proxVencImporte if cliente.proxVencImporte is not None
                else (cat.cuota_servicios if cliente.tipoActividad == "servicios" else cat.cuota_comercio)
            ),
        },
        {"key": "estadoCuota", "label": "Estado de la cuota",
         "valor": "Con deuda" if cliente.estadoCuotaMesActual == "con-deuda" else "Al día"},
        {"key": "proximoVencimiento", "label": "Próximo vencimiento", "valor": cliente.proxVencFecha or "—"},
        {"key": "deudaCuota", "label": "Deuda de cuota", "valor": fmt_currency(cliente.cuotaDeuda or 0)},
        {
            "key": "mesesAdeudados",
            "label": "Meses adeudados",
            "valor": f"{meses} {'mes' if meses == 1 else 'meses'} seguido{'' if meses == 1 else 's'}" if meses >= 1 else None,
        },
        {
            "key": "saldoFavor",
            "label": "Saldo a favor",
            "valor": fmt_currency(cliente.cuotaSaldoFavor)
            if cliente.cuotaSaldoFavor and cliente.cuotaSaldoFavor > 0 else None,
        },
    ]
    return Datos(
        calc=calc, situacion=sit, no_mono=no_mono, debe_recategorizar=debe, historial=historial,
        alertas=alertas, pendientes=pendientes, acciones=acciones,
        metricas=[m for m in metricas if m["valor"] is not None],
    )


# ── Mail (espejo de reporteMail.ts) ────────────────────────────────────────────────────────────

C = {
    "tinta": "#1f2329", "suave": "#6b7280", "borde": "#e5e7eb", "fondo": "#f8fafc",
    "primario": "#2563eb", "aviso": "#fef3c7", "avisoBorde": "#f59e0b",
}
SEV = {"urgente": "#dc2626", "aviso": "#f59e0b", "datos": "#9ca3af", "ok": "#16a34a"}


def _mes_legible(mes: str) -> str:
    y, _, m = mes.partition("-")
    return f"{m}/{y}" if m and y else mes


def _h2(t: str) -> str:
    return f'<h2 style="margin:28px 0 10px;font-size:16px;font-weight:bold;color:{C["tinta"]};">{esc(t)}</h2>'


def _p(t: str, color: str = C["suave"]) -> str:
    return f'<p style="margin:6px 0;font-size:14px;line-height:1.5;color:{color};">{t}</p>'


def _tabla(cabecera: list[tuple[str, bool]], filas: list[list[str]]) -> str:
    th = "".join(
        f'<th style="padding:8px 6px;border-bottom:1px solid {C["borde"]};font-size:12px;font-weight:normal;'
        f'color:{C["suave"]};text-align:{"right" if der else "left"};">{esc(t)}</th>'
        for t, der in cabecera
    )
    tr = "".join(
        "<tr>" + "".join(
            f'<td style="padding:7px 6px;border-bottom:1px solid {C["borde"]};font-size:14px;color:{C["tinta"]};'
            f'text-align:{"right" if i < len(cabecera) and cabecera[i][1] else "left"};white-space:nowrap;">{v}</td>'
            for i, v in enumerate(f)
        ) + "</tr>"
        for f in filas
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        f"<thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>"
    )


def armar_mail(cliente, datos: Datos, rep: dict, observaciones: str, estudio: str, hoy: dt.date) -> dict:
    calc = datos.calc
    no_mono = datos.no_mono
    hoy_txt = fmt_fecha(hoy, "long")
    titulo = f"Reporte de situación {'fiscal' if no_mono else 'de monotributo'}"
    partes: list[str] = []
    texto: list[str] = [f"{titulo} — {cliente.nombre} (CUIT {fmt_cuit(cliente.cuit)})", f"Generado el {hoy_txt}", ""]
    cat_txt = f" · Categoría {esc(cliente.categoria)}" if not no_mono and cliente.categoria else ""
    partes.append(f"""
<div style="background:#ffffff;border:1px solid {C['borde']};border-radius:12px;padding:28px 24px;">
  <div style="font-size:13px;color:{C['suave']};">{esc(estudio)} · {esc(hoy_txt)}</div>
  <h1 style="margin:6px 0 4px;font-size:21px;color:{C['tinta']};">{esc(titulo)}</h1>
  <div style="font-size:15px;color:{C['tinta']};"><strong>{esc(cliente.nombre)}</strong> · CUIT {esc(fmt_cuit(cliente.cuit))}</div>
  <div style="font-size:13px;color:{C['suave']};margin-top:2px;">{esc(etiqueta_regimen(cliente.regimen))}{cat_txt}</div>""")
    obs = (observaciones or "").strip()
    if obs:
        partes.append(
            f"""<div style="margin-top:20px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:8px;padding:14px 16px;">
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:{C['primario']};font-weight:bold;margin-bottom:4px;">Mensaje de tu contador</div>
        <div style="font-size:14px;line-height:1.55;color:{C['tinta']};white-space:pre-wrap;">{esc(obs)}</div>
      </div>"""
        )
        texto += ["Mensaje de tu contador:", obs, ""]
    if rep["secciones"].get("situacion"):
        if no_mono:
            partes.append(_h2("Situación fiscal"))
            partes.append(_p(
                f"{esc(etiqueta_regimen(cliente.regimen))}. Facturación de los últimos 12 meses: "
                f'<strong style="color:{C["tinta"]};">{esc(fmt_currency(calc.facturacionUltimos12))}</strong>.'
            ))
            texto += [f"Facturación últimos 12 meses: {fmt_currency(calc.facturacionUltimos12)}", ""]
        else:
            visibles = [m for m in datos.metricas if rep["metricas"].get(m["key"])]
            if visibles:
                partes.append(_h2("Situación de monotributo"))
                celdas = [
                    f"""<td width="50%" style="padding:6px;vertical-align:top;"><div style="border:1px solid {C['borde']};border-radius:8px;padding:12px 14px;">
              <div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:{C['suave']};">{esc(m['label'])}</div>
              <div style="font-size:18px;font-weight:bold;color:{C['tinta']};margin-top:3px;">{esc(m['valor'])}</div>
            </div></td>"""
                    for m in visibles
                ]
                vacia = '<td width="50%"></td>'
                filas = ""
                for i in range(0, len(celdas), 2):
                    filas += f"<tr>{celdas[i]}{celdas[i + 1] if i + 1 < len(celdas) else vacia}</tr>"
                partes.append(
                    f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px;">{filas}</table>'
                )
                partes.append(
                    f'<p style="margin:6px 0 0;font-size:12px;line-height:1.5;color:{C["suave"]};">{esc(datos.situacion["nota"])}</p>'
                )
                texto += ["Situación de monotributo:", *[f"- {m['label']}: {m['valor']}" for m in visibles], datos.situacion["nota"], ""]
            if datos.debe_recategorizar:
                msg = (
                    f"Con la facturación actual, debería recategorizarse a Cat. {calc.categoriaCorresponde.codigo} "
                    f"(tope {fmt_currency(calc.categoriaCorresponde.tope_anual)})."
                )
                partes.append(
                    f'<div style="margin-top:12px;background:{C["aviso"]};border:1px solid {C["avisoBorde"]};border-radius:8px;'
                    f'padding:12px 14px;font-size:14px;color:{C["tinta"]};">{esc(msg)}</div>'
                )
                texto.append(msg)
            if calc.proximaVentana:
                msg = (
                    f"Próxima ventana de recategorización: {fmt_fecha(calc.proximaVentana['fechaLimite'], 'long')} "
                    f"(semestre {calc.proximaVentana.get('semestre')})."
                )
                partes.append(_p(esc(msg)))
                texto += [msg, ""]
    hist = datos.historial
    if rep["secciones"].get("historial") and hist:
        partes.append(_h2(f"Historial de los últimos {'mes' if len(hist) == 1 else f'{len(hist)} meses'}"))
        partes.append(_tabla(
            [("Mes", False), ("Ventas netas", True), ("Compras", True)],
            [[esc(_mes_legible(m["mes"])), esc(fmt_currency(m["emitidasNetas"])), esc(fmt_currency(m["recibidas"]))] for m in hist],
        ))
        texto += ["Historial:", *[
            f"- {_mes_legible(m['mes'])}: ventas {fmt_currency(m['emitidasNetas'])} · compras {fmt_currency(m['recibidas'])}"
            for m in hist
        ], ""]
    if rep["secciones"].get("alertas"):
        partes.append(_h2("Alertas"))
        if not datos.alertas:
            partes.append(_p("Sin alertas activas."))
            texto += ["Alertas: sin alertas activas.", ""]
        else:
            filas = "".join(
                f"""<tr><td width="16" style="vertical-align:top;padding:9px 0 0;"><div style="width:8px;height:8px;border-radius:4px;background:{SEV.get(a['severidad'], SEV['datos'])};"></div></td>
            <td style="padding:4px 0;font-size:14px;line-height:1.5;color:{C['tinta']};"><strong>{esc(a['titulo'])}.</strong> <span style="color:{C['suave']};">{esc(a['detalle'])}</span></td></tr>"""
                for a in datos.alertas
            )
            partes.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{filas}</table>')
            texto += ["Alertas:", *[f"- {a['titulo']}. {a['detalle']}" for a in datos.alertas], ""]
    if rep["secciones"].get("movimientos"):
        partes.append(_h2("Movimientos pendientes de respaldo fiscal"))
        if not datos.pendientes:
            partes.append(_p("No hay movimientos pendientes de respaldo."))
        else:
            filas_m = []
            for m in datos.pendientes:
                orig = esc(m.nombre_originante or m.descripcion or "—")
                if m.cuit_originante:
                    orig += f' <span style="color:{C["suave"]};">· {esc(fmt_cuit(m.cuit_originante))}</span>'
                filas_m.append([esc(fmt_fecha(m.fecha)), orig, esc(fmt_currency(float(m.monto)))])
            partes.append(_tabla([("Fecha", False), ("Originante", False), ("Monto", True)], filas_m))
            texto += ["Movimientos pendientes de respaldo:", *[
                f"- {fmt_fecha(m.fecha)} {m.nombre_originante or m.descripcion or ''}: {fmt_currency(float(m.monto))}"
                for m in datos.pendientes
            ], ""]
    if rep["secciones"].get("acciones") and datos.acciones:
        partes.append(_h2("Acciones sugeridas"))
        partes.append(
            '<ul style="margin:0;padding-left:20px;">'
            + "".join(f'<li style="font-size:14px;line-height:1.55;color:{C["tinta"]};margin:3px 0;">{esc(a)}</li>' for a in datos.acciones)
            + "</ul>"
        )
        texto += ["Acciones sugeridas:", *[f"- {a}" for a in datos.acciones], ""]
    partes.append("</div>")
    mes_anio = f"{MESES_LARGOS[hoy.month - 1]} de {hoy.year}"
    return {
        "asunto": f"Reporte de {'situación fiscal' if no_mono else 'monotributo'} — {cliente.nombre} — {mes_anio}",
        "html": "\n".join(partes),
        "texto": "\n".join(texto),
    }


# ── Punto de entrada ───────────────────────────────────────────────────────────────────────────


def armar_reporte(
    db: Session,
    usuario: models.Usuario,
    cliente_arca: models.ClienteARCA,
    *,
    observaciones: str = "",
    estudio: str,
    incluir_movimientos: bool,
    hoy: dt.date | None = None,
) -> dict:
    """{asunto, html, texto} del reporte de un cliente, con las opciones del reporte de ese cliente
    (o las generales del contador) y los datos de hoy. `incluir_movimientos` = el plan tiene
    conciliación (sin ella el front no ve movimientos y la sección sale vacía)."""
    from . import conciliacion

    hoy = hoy or dt.datetime.now(TZ_AR).date()
    cliente = armar_cliente(db, cliente_arca)
    config = config_usuario(usuario, hoy)
    rep = opciones_reporte(config["reporte"], cliente.reporteConfig)
    movimientos = conciliacion.listar(db, cliente_arca.cuit) if incluir_movimientos else []
    datos = armar_datos(cliente, config, movimientos, rep, hoy)
    return armar_mail(cliente, datos, rep, observaciones, estudio, hoy)
