"""
CCMA — Cuenta Corriente de Monotributistas y Autónomos. Estado de la cuota + detalle de deuda.

Dos caminos hasta la misma pantalla de 'Consulta de Deuda' (servicios2.afip.gob.ar/.../ccam/):
  1) estado_cuota(): desde el portal Monotributo, botón 'Ver Saldo / Pagar'. Sólo monotributistas,
     pero reusa la sesión que ya abrió padron.datos_monotributo (sin login extra).
  2) consultar_deuda(): camino DIRECTO — portal → 'Estado de cuenta' → seleccionaCuit.asp (elegir
     CUIT) → P01 (período) → 'CÁLCULO DE DEUDA' → P02. Sirve también para autónomos y representados.

Ambos terminan en P02_ctacte.asp, que parsea extraer_detalle_deuda():
  - Total Saldo Deudor = Obligación Mensual (capital) + Accesorios (intereses).
  - Movimientos del ledger por período (impuesto, concepto, vencimiento, debe, haber).
Los montos vienen en formato US (punto decimal, coma de miles): '14,625.46'.
"""
from __future__ import annotations

import re
import shutil
import tempfile

import lxml.html
from patchright.sync_api import sync_playwright

from ..config import settings
from . import _comun

BASE_CCMA = "https://servicios2.afip.gob.ar/tramites_con_clave_fiscal/ccam/"

# Mensaje al usuario cuando el cliente no tiene estado de cuenta: la cuenta corriente es exclusiva de
# monotributistas y autónomos, así que para un RI / sociedad no corresponde. En términos del contador
# (sin exponer el mecanismo), no menciona el porqué técnico (que el CUIT no esté en el listado).
MSG_NO_CCMA = "El estado de cuenta solo aplica a monotributistas y autónomos, y este cliente no es ninguno de los dos."


def _num_us(s: str) -> float:
    """'14,625.46' / '0.00' / '(4,780.46)' -> float (formato US: punto decimal, coma de miles)."""
    s = (s or "").strip().replace("(", "").replace(")", "").replace("\xa0", "")
    if not s:
        return 0.0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def extraer_detalle_deuda(html: str) -> dict:
    """Parsea la pantalla de 'Consulta de Deuda' (P02_ctacte.asp). Devuelve totales + desglose
    (capital/intereses) + el ledger de movimientos por período. Campos None si no se encontraron."""
    out: dict = {
        "fecha_calculo": None, "periodo_desde": None, "periodo_hasta": None,
        "deudor": None, "acreedor": None, "capital": None, "intereses": None,
        "movimientos": [], "por_periodo": [],
    }
    m = re.search(r'name="feccalculo"\s+value="([\d/]+)"', html)
    out["fecha_calculo"] = m.group(1) if m else None
    m = re.search(r'id="periodoMinimo"\s+value="([\d/]+)"', html)
    out["periodo_desde"] = m.group(1) if m else None
    m = re.search(r'id="periodoMaximo"\s+value="([\d/]+)"', html)
    out["periodo_hasta"] = m.group(1) if m else None
    md = re.search(r"Total Saldo Deudor:.*?CeldaTitularResaltado[^>]*>\s*([\d.,]+)", html, re.S | re.I)
    ma = re.search(r"Total Saldo Acreedor:.*?CeldaTitularResaltado[^>]*>\s*([\d.,]+)", html, re.S | re.I)
    out["deudor"] = _num_us(md.group(1)) if md else None
    out["acreedor"] = _num_us(ma.group(1)) if ma else None
    # Desglose del lado DEUDOR (1ra ocurrencia de cada label = columna deudora):
    #   Total Saldo Deudor = Obligación Mensual (capital) + Accesorios (intereses).
    mc = re.search(r"Obligaci[oó]n Mensual:\s*</td>.*?Celda[^>]*>\s*([\d.,]+)", html, re.S | re.I)
    mi = re.search(r"Accesorios:\s*</td>.*?Celda[^>]*>\s*([\d.,]+)", html, re.S | re.I)
    out["capital"] = _num_us(mc.group(1)) if mc else None
    out["intereses"] = _num_us(mi.group(1)) if mi else None

    # Ledger: filas con celdas CeldaBorde_ConsDeuFec y un monto en Debe o Haber (las filas de
    # subtotal 'Saldo' no tienen monto → se descartan solas). Columnas: 2=período, 3=impuesto,
    # 4=concepto, 6=descripción, 7=fecha venc., 8=debe, 9=haber.
    acum: dict = {}
    try:
        doc = lxml.html.fromstring(html)
    except Exception:  # noqa: BLE001 — HTML roto: devolvemos al menos los totales
        return out
    for tr in doc.xpath('//tr[td[contains(@class,"CeldaBorde_ConsDeuFec")]]'):
        tds = tr.xpath("./td")
        if len(tds) < 10:
            continue
        cel = [" ".join((td.text_content() or "").split()) for td in tds[:10]]
        periodo, debe, haber = cel[2], _num_us(cel[8]), _num_us(cel[9])
        if (debe == 0 and haber == 0) or not re.match(r"\d{2}/\d{4}", periodo):
            continue
        out["movimientos"].append({
            "periodo": periodo, "impuesto": cel[3], "concepto": cel[4],
            "descripcion": cel[6], "vencimiento": cel[7], "debe": debe, "haber": haber,
        })
        a = acum.setdefault(periodo, {"debe": 0.0, "haber": 0.0})
        a["debe"] += debe
        a["haber"] += haber
    out["por_periodo"] = [
        {"periodo": p, "debe": round(v["debe"], 2), "haber": round(v["haber"], 2),
         "saldo": round(v["debe"] - v["haber"], 2)}
        for p, v in acum.items()
    ]
    return out


def _resumen_cuota(detalle: dict) -> dict:
    """De un detalle parseado, los 3 campos que ya usa Órbita + el detalle completo para guardar."""
    deudor = detalle.get("deudor")
    if deudor is None:
        return {}
    return {
        "cuota_estado": "con-deuda" if deudor > 0 else "al-dia",
        "cuota_deuda": deudor,
        "cuota_saldo_favor": detalle.get("acreedor") or 0.0,
        "deuda_detalle": detalle,
    }


def _ccma_tab(ctx):
    return next((p for p in ctx.pages if "ccam" in p.url.lower()), None)


def _calcular_y_parsear(ccma, ctx) -> dict:
    """En la pestaña CCMA: va a P02, dispara 'CÁLCULO DE DEUDA' (defaults a hoy) y parsea el detalle."""
    ccma.on("dialog", lambda d: d.accept())  # acepta los alert de validación del form
    try:
        ccma.goto(BASE_CCMA + "P02_ctacte.asp")
        ccma.wait_for_timeout(2500)
        ccma.locator("input[name='CalDeud']").first.click()  # CÁLCULO DE DEUDA
        ccma.wait_for_timeout(9000)
    except Exception:  # noqa: BLE001
        pass
    ccma = _ccma_tab(ctx) or ccma
    return extraer_detalle_deuda(ccma.content())


def estado_cuota(mt, ctx) -> dict:
    """Con el portal Monotributo ya abierto (`mt`), hace 'Ver Saldo / Pagar', dispara el cálculo de
    deuda a hoy y devuelve {cuota_estado, cuota_deuda, cuota_saldo_favor, deuda_detalle}. {} si falla."""
    try:
        mt.get_by_text(re.compile("Ver Saldo", re.I)).first.click()
        mt.wait_for_timeout(7000)
    except Exception:  # noqa: BLE001
        return {}
    ccma = _ccma_tab(ctx)
    if ccma is None:
        return {}
    return _resumen_cuota(_calcular_y_parsear(ccma, ctx))


def _abrir_estado_cuenta(page, ctx):
    """Portal → tile 'Estado de cuenta' (o el buscador como fallback) → abre la CCMA."""
    page.goto(_comun.PORTAL)
    _comun.esperar_idle(page)
    try:
        tile = page.locator("a.accesoPrincipal", has_text=re.compile("Estado de cuenta", re.I)).first
        if tile.count() > 0:
            tile.click()
        else:
            page.get_by_text(re.compile("Estado de cuenta", re.I)).first.click()
        page.wait_for_timeout(6000)
    except Exception:  # noqa: BLE001 — fallback: buscarlo en el typeahead del portal
        _comun.buscar_servicio(ctx, page, "cuenta corriente", "Cuenta Corriente", "select[name='selectCuit'], input[name='CalDeud']")
    return _comun.esperar_en_pestanas(ctx, "select[name='selectCuit'], input[name='CalDeud']", 20000)


def consultar_deuda(
    cuit_login: str, clave: str, cuit_objetivo: str | None = None, headless: bool | None = None
) -> dict:
    """Camino DIRECTO a la CCMA (sirve para monotributistas, autónomos y representados): login →
    'Estado de cuenta' → elegir CUIT → CÁLCULO DE DEUDA. Devuelve {cuota_estado, cuota_deuda,
    cuota_saldo_favor, deuda_detalle} o {} si no se pudo. La clave se usa y se descarta."""
    if headless is None:
        headless = settings.scraping_headless
    objetivo = (cuit_objetivo or cuit_login).strip()
    perfil = tempfile.mkdtemp(prefix="orbita_ccma_")
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless=headless, user_data_dir=perfil)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                _comun.login(page, cuit_login, clave)
                ccma = _abrir_estado_cuenta(page, ctx)
                if ccma is None:
                    return {}
                ccma.on("dialog", lambda d: d.accept())
                # seleccionaCuit.asp: elegir el CUIT objetivo y enviar el form. CRÍTICO: el HTML de
                # la deuda NO trae el CUIT, así que la ÚNICA garantía de a quién pertenece es esta
                # selección. Si el objetivo NO está entre las opciones (p. ej. una S.R.L./RI sin
                # cuenta corriente de Monotributo/Autónomos), NO scrapeamos: caer al CUIT por defecto
                # le atribuiría a este cliente la deuda de OTRO. Devolvemos 'no_aplica'.
                sel = ccma.locator("select[name='selectCuit']")
                if sel.count() > 0:
                    opciones = [(o.get_attribute("value") or "").strip() for o in sel.locator("option").all()]
                    if objetivo not in opciones:
                        return {"no_aplica": True, "motivo": MSG_NO_CCMA}
                    sel.select_option(value=objetivo)
                    ccma.wait_for_timeout(800)
                    try:  # verificación dura: el option realmente seleccionado debe ser el objetivo
                        elegido = (sel.input_value() or "").strip()
                    except Exception:  # noqa: BLE001
                        elegido = ""
                    if elegido and elegido != objetivo:
                        # No se fijó el CUIT pese a estar en el listado (o sea, el cliente SÍ es
                        # elegible): es un fallo transitorio, NO un "no aplica" → {} para que NO se
                        # persista y se pueda reintentar. (Distinto de los "no aplica" definitivos.)
                        return {}
                    # El form se envía por botón/submit; probamos botón y caemos a form.submit().
                    enviado = False
                    for sl in ("input[type='submit']", "input[type='button'][value*='ontinuar' i]", "input[value*='eleccionar' i]"):
                        b = ccma.locator(sl)
                        if b.count() > 0:
                            b.first.click()
                            enviado = True
                            break
                    if not enviado:
                        try:
                            ccma.evaluate("document.forms[0] && document.forms[0].submit()")
                        except Exception:  # noqa: BLE001
                            pass
                    ccma.wait_for_timeout(6000)
                elif objetivo != cuit_login:
                    # Sin selector y consultando a un representado que no tiene cuenta corriente
                    # (un RI / sociedad): abortamos en vez de arriesgar datos cruzados. Para el
                    # contador es lo mismo que el caso de arriba → mismo mensaje de "no aplica".
                    return {"no_aplica": True, "motivo": MSG_NO_CCMA}
                ccma = _ccma_tab(ctx) or ccma
                return _resumen_cuota(_calcular_y_parsear(ccma, ctx))
            finally:
                ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
