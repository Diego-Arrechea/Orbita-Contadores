"""Cálculo de monotributo del backend, ESPEJO de `src/lib/monotributo.ts` (+ las normalizaciones que
hace `src/services/clientesService.ts::armarCliente`).

Sirve para que el motor de alertas (services/alertas.py) pueda evaluar TODOS los tipos de alerta
—tope, recategorización, ventana, gastos— sin depender del front. Opera sobre un `ClienteOut` ya
armado (mismos insumos que ve la UI: historial 12m, categoría, cuota, etc.), así que mientras este
archivo y monotributo.ts usen la misma escala (data/categorias.py ↔ data/categorias.ts) el resultado
coincide con lo que muestra la app.

Es puro: no toca la DB. Determinista.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from ..data.categorias import (
    CATEGORIAS,
    RATIO_GASTOS_COMERCIO,
    RATIO_GASTOS_SERVICIOS,
    TOPE_CATEGORIA_K,
    get_categoria,
    inferir_categoria,
)
from ..schemas import ClienteOut, HistorialMesOut

_CODIGOS = {c.codigo for c in CATEGORIAS}


def _mes_idx(mes: str) -> int:
    """'aaaa-mm' → índice de mes absoluto (year*12 + (month-1)) para comparar ventanas."""
    y, mo = mes.split("-")
    return int(y) * 12 + (int(mo) - 1)


def ventana_12_meses(
    historial: list[HistorialMesOut], hasta: dt.date
) -> list[HistorialMesOut]:
    """Meses del historial dentro de los 12 meses CALENDARIO que terminan en `hasta` (inclusive).
    Espejo de ventana12Meses(): anclar a una fecha real evita sumar de más cuando hay meses sin
    facturar (que no existen como fila en el historial)."""
    fin_idx = hasta.year * 12 + (hasta.month - 1)
    desde_idx = fin_idx - 11
    return [m for m in historial if desde_idx <= _mes_idx(m.mes) <= fin_idx]


def _sumar_meses(fecha: dt.date, n: int) -> dt.date:
    """Avanza `n` meses (clamp del día al último día del mes destino)."""
    total = (fecha.year * 12 + (fecha.month - 1)) + n
    y, mo = divmod(total, 12)
    mo += 1
    # último día del mes destino (clamp, ej. 31-ene + 1 mes → 28/29-feb)
    if mo == 12:
        ult = 31
    else:
        ult = (dt.date(y, mo + 1, 1) - dt.timedelta(days=1)).day
    return dt.date(y, mo, min(fecha.day, ult))


def _proyectar_cruce_tope(
    acumulado_12: float, promedio_mensual: float, variacion: float, tope: float, hoy: dt.date
) -> dt.date | None:
    """Mes estimado en que la facturación acumulada cruzaría el tope, a ritmo reciente + tendencia.
    Espejo de proyectarCruceTope(): None si ya lo superó o si no cruza en 36 meses."""
    if acumulado_12 >= tope:
        return None
    acumulado = acumulado_12
    prom = promedio_mensual
    for i in range(1, 37):
        prom = prom * (1 + max(-0.1, min(variacion, 0.2)))
        acumulado += prom
        if acumulado >= tope:
            return _sumar_meses(hoy, i)
    return None


@dataclass
class CalculoCliente:
    es_monotributista: bool
    categoria_norm: str | None  # categoría efectiva (padrón o inferida), como la usa el front
    facturacion_ultimos_12: float
    porcentaje_tope_actual: float
    categoria_corresponde: str
    ratio_gastos_tope_k: float
    ratio_umbral_legal: float
    ratio_superado_legal: bool
    fecha_proyectada_cruce_tope: dt.date | None
    dias_para_proxima_ventana: float  # inf si no hay ventana futura
    proxima_ventana: dict | None


def _es_monotributista(cliente: ClienteOut, categoria_real: str | None) -> bool:
    """Espejo de esMonotributista() + el override de armarCliente: monotributista si el régimen lo
    dice (o no se sabe) o si hay categoría real del padrón. Nunca se asume por ausencia de dato salvo
    que el régimen sea explícitamente None."""
    if categoria_real is not None:
        return True
    return cliente.regimen is None or cliente.regimen == "monotributo"


def calcular_cliente(
    cliente: ClienteOut,
    ventanas: list[dict],
    inflacion_mensual: float,
    hoy: dt.date | None = None,
) -> CalculoCliente:
    """Calcula los insumos de las alertas de un cliente. `ventanas` es la lista de la config del
    contador (cada una con 'fechaLimite' aaaa-mm-dd). `hoy` parametrizable para tests."""
    hoy = hoy or dt.date.today()
    historial = cliente.historial_mensual

    # --- Normalizaciones que el front hace en armarCliente (categoría / actividad / fecha inicio) ---
    categoria_real = cliente.categoria if cliente.categoria in _CODIGOS else None
    es_monot = _es_monotributista(cliente, categoria_real)
    fact_12_total = sum(m.emitidasNetas for m in ventana_12_meses(historial, hoy))
    categoria_norm = categoria_real or (
        inferir_categoria(fact_12_total) if es_monot else None
    )
    actividad = cliente.actividad if cliente.actividad in ("comercio", "servicios") else "servicios"
    primer_mes = historial[0].mes if historial else None
    fecha_inicio_str = cliente.fecha_inicio or (f"{primer_mes}-01" if primer_mes else "2020-01-01")

    # --- Cálculo (espejo de calcularCliente) ---
    ultimos12 = ventana_12_meses(historial, hoy)
    facturacion12 = sum(m.emitidasNetas + m.ingresosNoFacturados for m in ultimos12)
    compras12 = sum(m.recibidasComputables for m in ultimos12)

    try:
        fecha_inicio = dt.date.fromisoformat(fecha_inicio_str[:10])
    except ValueError:
        fecha_inicio = dt.date(2020, 1, 1)
    meses_actividad = max(1, (hoy - fecha_inicio).days // 30)
    meses_efectivos = min(12, meses_actividad)
    facturacion_anualizada = (
        facturacion12 / meses_efectivos * 12 if meses_efectivos < 12 else facturacion12
    )

    categoria_actual = get_categoria(categoria_norm)
    # Nivel autoritativo (tope/categoría/proyección): cifra OFICIAL de ARCA (facturómetro del padrón)
    # cuando está; si no, el cálculo propio por comprobantes (anualizado si <12m). Espejo de
    # monotributo.ts. El oficial ya incluye lo que ARCA computa (p. ej. liquidaciones del agro que el
    # productor NO emite) → no subdeclara. La TENDENCIA sigue por comprobantes (el oficial es un único
    # total 12m, sin desglose mensual).
    # OJO: sólo vale el oficial > 0. El panel de ARCA a veces responde 0 por una carga incompleta del
    # AJAX (con la fecha de corte ya puesta); ese 0 NO es real (lo delata tener comprobantes por
    # encima) → chequeamos > 0, no `is not None`, para no pisar todo con 0.
    oficial_valido = cliente.facturacion_12m is not None and cliente.facturacion_12m > 0
    tope_oficial_valido = cliente.tope_categoria is not None and cliente.tope_categoria > 0
    nivel_tope = cliente.facturacion_12m if oficial_valido else facturacion_anualizada
    tope_ref = cliente.tope_categoria if tope_oficial_valido else categoria_actual.tope_anual
    porcentaje_tope = nivel_tope / tope_ref if tope_ref else 0.0
    categoria_corresponde = next(
        (c.codigo for c in CATEGORIAS if nivel_tope <= c.tope_anual),
        CATEGORIAS[-1].codigo,
    )

    ratio_gastos_tope_k = compras12 / TOPE_CATEGORIA_K
    ratio_umbral_legal = RATIO_GASTOS_COMERCIO if actividad == "comercio" else RATIO_GASTOS_SERVICIOS
    ratio_superado = ratio_gastos_tope_k > ratio_umbral_legal

    prom_ult3 = sum(m.emitidasNetas + m.ingresosNoFacturados for m in ultimos12[-3:]) / 3
    ant3 = ultimos12[-6:-3]
    prom_ant3 = (sum(m.emitidasNetas + m.ingresosNoFacturados for m in ant3) / 3) or prom_ult3
    variacion = (prom_ult3 - prom_ant3) / prom_ant3 / 3 if prom_ant3 > 0 else 0.0
    # Arranca del nivel oficial (lo ya acumulado según ARCA) y proyecta con el ritmo de comprobantes.
    acumulado_proy = cliente.facturacion_12m if oficial_valido else facturacion12
    fecha_proyectada = _proyectar_cruce_tope(
        acumulado_proy, prom_ult3, variacion, tope_ref, hoy
    )

    futuras = sorted(
        (
            {**v, "dias": (dt.date.fromisoformat(v["fechaLimite"][:10]) - hoy).days}
            for v in ventanas
            if v.get("fechaLimite")
        ),
        key=lambda v: v["dias"],
    )
    futuras = [v for v in futuras if v["dias"] >= 0]
    proxima = futuras[0] if futuras else None

    return CalculoCliente(
        es_monotributista=es_monot,
        categoria_norm=categoria_norm,
        facturacion_ultimos_12=facturacion12,
        porcentaje_tope_actual=porcentaje_tope,
        categoria_corresponde=categoria_corresponde,
        ratio_gastos_tope_k=ratio_gastos_tope_k,
        ratio_umbral_legal=ratio_umbral_legal,
        ratio_superado_legal=ratio_superado,
        fecha_proyectada_cruce_tope=fecha_proyectada,
        dias_para_proxima_ventana=proxima["dias"] if proxima else float("inf"),
        proxima_ventana=proxima,
    )
