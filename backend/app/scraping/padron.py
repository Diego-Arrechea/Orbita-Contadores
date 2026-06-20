"""
Padrón de Monotributo — trae la categoría REAL, la actividad y el próximo período de
recategorización desde el portal Monotributo (monotributo.afip.gob.ar). Login con la clave del
contador. Para no-monotributistas (p. ej. Responsables Inscriptos) el servicio no aplica.
"""
from __future__ import annotations

import re
import shutil
import tempfile
import time

from patchright.sync_api import sync_playwright

from ..config import settings
from . import _comun, ccma

# Reintentos ante timeouts transitorios de ARCA al abrir el portal Monotributo (mismo fenómeno que
# en Mis Comprobantes). Sólo se reintenta ante EXCEPCIÓN; un {} / es_monotributista=False es un
# resultado válido (no aplica), no un error, y no se reintenta. Backoff incremental.
PADRON_REINTENTOS = 2


def extraer(html: str) -> dict:
    """Parsea categoría / actividad / próxima recategorización del HTML del portal Monotributo."""
    out: dict = {"categoria": None, "actividad": None, "prox_recategorizacion": None, "cuit": None}
    m = re.search(r"Categor[ií]a\s+([A-K])\s+([^<]+?)\s*</strong>", html)
    if m:
        out["categoria"] = m.group(1).strip()
        act = m.group(2).upper()
        out["actividad"] = (
            "comercio" if ("VENTA" in act or "BIEN" in act or "MUEBLE" in act) else "servicios"
        )
    m2 = re.search(r'id="divProxRecategorizacion".*?<strong>\s*(.*?)\s*</strong>', html, re.S | re.I)
    if m2:
        out["prox_recategorizacion"] = " ".join(m2.group(1).split())
    m3 = re.search(r'id="hidCUITContribuyente"\s+value="(\d+)"', html)
    if m3:
        out["cuit"] = m3.group(1)
    # Próximo vencimiento de la cuota (panel "Próximo vencimiento"). Importe en formato AR.
    mf = re.search(r"vencimiento es el\s*(\d{1,2}-[a-zA-Z]{3,}-\d{4})", html, re.I)
    if mf:
        out["prox_venc_fecha"] = mf.group(1)
    mi = re.search(r"importe a pagar es\s*\$?\s*([\d.]+,\d{2})", html, re.I)
    if mi:
        out["prox_venc_importe"] = float(mi.group(1).replace(".", "").replace(",", "."))
    # Débito automático: el texto "débito automático" SIEMPRE está en la tarjeta (adherido o no), así
    # que NO sirve para detectarlo (daba true para todos). La señal real es el botón de la tarjeta
    # #tDebitoAutomatico: dice "Adherirme" (CTA a CBU.aspx) cuando NO está adherido; si ya lo está, la
    # tarjeta no ofrece adherirse. Aislamos la tarjeta (hasta el próximo panel) y vemos si invita a
    # adherirse. (No vimos el HTML del estado "adherido": se infiere por AUSENCIA del CTA "Adherirme".)
    mdeb = re.search(r'id="tDebitoAutomatico".*?(?=<div id="t[A-Za-z]|</body)', html, re.S | re.I)
    if mdeb:
        out["debito_automatico"] = "adherirme" not in mdeb.group(0).lower()
    else:
        out["debito_automatico"] = None  # sin tarjeta de débito → desconocido (no pisar lo que haya)
    # Facturómetro (panel facturación-vs-tope de Inicio.aspx). Lo llena un AJAX
    # (inicio.aspx/CalcularFacturacion) → el caller espera a que el monto aparezca antes de leer.
    #   facturacion_12m = ingresos brutos devengados de los últimos 12 meses SEGÚN ARCA (numerador).
    #   tope_categoria  = tope oficial de la categoría actual (denominador). Es el dato autoritativo
    #                     del gauge; el cálculo por comprobantes queda como estimación al día.
    # SELF-HEAL del 0 transitorio: a veces el AJAX CalcularFacturacion deja el panel renderizado
    # (con la fecha de corte ya puesta) pero el monto/tope en 0. Persistir ese 0 pisaría el último
    # valor bueno → la ficha mostraría $0 sobre un cliente que sí facturó. Por eso sólo tomamos el
    # facturómetro si el monto es > 0, y atamos fecha+tope a ese monto: si vino 0/ausente, NO se
    # persiste ninguno de los tres → el cliente conserva su valor previo y el próximo sync lo auto-cura.
    mfm = re.search(r'id="spanFacturometroMonto"[^>]*>\s*\$?\s*([\d.]+,\d{2})', html)
    monto = float(mfm.group(1).replace(".", "").replace(",", ".")) if mfm else 0.0
    if monto > 0:
        out["facturacion_12m"] = monto
        mft = re.search(r'id="spanFacturometroCategoriaTope"[^>]*>\s*\$?\s*([\d.]+,\d{2})', html)
        if mft:
            tope = float(mft.group(1).replace(".", "").replace(",", "."))
            if tope > 0:
                out["tope_categoria"] = tope
        mfa = re.search(r'id="spanFacturometroActualizacion"[^>]*>\s*(\d{2}/\d{2}/\d{4})', html)
        if mfa:
            out["facturometro_actualizado"] = mfa.group(1)
    return out


def _abrir_monotributo(page, ctx):
    page.goto(_comun.PORTAL)
    # esperar_idle TOLERANTE: ARCA nunca queda 'networkidle' y el wait a secas colgaba 30s tirando
    # un "Timeout 30000ms exceeded." genérico (la causa de los timeouts de padrón).
    _comun.esperar_idle(page)
    b = page.locator("#buscadorInput")
    b.wait_for(state="visible", timeout=20000)
    b.click()
    b.fill("")
    b.press_sequentially("monotributo", delay=80)
    page.wait_for_timeout(3000)
    page.locator('li[role="option"]').filter(has_text=re.compile("monotributo", re.I)).first.click()
    page.wait_for_timeout(8000)
    _comun.click_continuar_si_aparece(ctx)
    page.wait_for_timeout(3000)
    return next((pg for pg in ctx.pages if "monotributo.afip" in pg.url), None)


def datos_monotributo(
    cuit_login: str, clave: str, cuit_objetivo: str | None = None, headless: bool | None = None
) -> dict:
    """Abre el portal Monotributo y devuelve {categoria, actividad, prox_recategorizacion, cuit, +
    facturómetro/cuota}. `cuit_objetivo` = de quién queremos los datos: si es un REPRESENTADO (≠ login)
    se fija 'actuando en representación' en Relaciones antes de abrir el portal (igual que el bootstrap
    del cert) y se VERIFICA que el portal abrió el del representado (guard anti-cruce). Sin objetivo =
    el titular logueado.

    Reintenta ante timeouts transitorios de ARCA (ver PADRON_REINTENTOS). Un resultado válido de
    'no aplica' ({} o {es_monotributista: False}) NO es excepción → no se reintenta."""
    if headless is None:
        headless = settings.scraping_headless
    ultimo_error: Exception | None = None
    for intento in range(PADRON_REINTENTOS + 1):
        try:
            return _datos_monotributo_intento(cuit_login, clave, cuit_objetivo, headless)
        except Exception as e:  # noqa: BLE001 — timeout/caída transitoria de ARCA; reintentar
            ultimo_error = e
            if intento < PADRON_REINTENTOS:
                time.sleep(5 * (intento + 1))  # backoff incremental: 5s, 10s
    raise ultimo_error  # type: ignore[misc]


def _datos_monotributo_intento(
    cuit_login: str, clave: str, cuit_objetivo: str | None, headless: bool
) -> dict:
    """Un intento de scrape del portal Monotributo (ver datos_monotributo)."""
    objetivo = (cuit_objetivo or cuit_login).strip()
    es_representado = objetivo != cuit_login.strip()
    perfil = tempfile.mkdtemp(prefix="orbita_mt_")
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless=headless, user_data_dir=perfil)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                _comun.login(page, cuit_login, clave)
                if es_representado:
                    # Fijar "actuando en representación" en Relaciones ANTES de abrir el portal, para
                    # que Monotributo abra el del representado y no el del contador. Mismo patrón que
                    # el bootstrap del cert (Relaciones → portal → servicio mantiene el contexto). Si
                    # falla, el guard anti-cruce de más abajo evita atribuir la categoría del contador.
                    try:
                        rel = _comun.ir_a_relaciones(ctx, page)
                        _comun.seleccionar_contribuyente(rel or page, objetivo)
                    except Exception:  # noqa: BLE001
                        pass
                mt = _abrir_monotributo(page, ctx)
                if mt is None:
                    # No abrió el portal. Para el TITULAR = señal oficial de que NO es monotributista
                    # (RI / exento / empleado / consumidor final) → se persiste como 'no_monotributo'.
                    # Para un REPRESENTADO NO podemos afirmar eso: pudo fallar la representación → {}
                    # (no se pisa nada; el front sigue con la inferencia por comprobantes).
                    return {"es_monotributista": False} if not es_representado else {}
                mt.wait_for_timeout(2000)
                # El facturómetro (monto facturado + tope) lo llena un AJAX con ~2s de delay;
                # esperamos a que el monto tenga contenido para no leer el panel vacío. Best-effort:
                # si la cuenta no tiene facturómetro, sigue de largo al vencer el timeout.
                try:
                    mt.wait_for_function(
                        "() => { const e = document.getElementById('spanFacturometroMonto');"
                        " return e && e.textContent.trim().length > 0; }",
                        timeout=12000,
                    )
                except Exception:  # noqa: BLE001
                    pass
                datos = extraer(mt.content())
                # GUARD ANTI-CRUCE (representados): el portal trae el CUIT del titular mostrado en
                # #hidCUITContribuyente. Si NO coincide con el objetivo, la representación no tomó y
                # estaríamos por leer la categoría del CONTADOR → abortamos sin atribuir nada ({}).
                # Mismo criterio que el selectCuit de ccma.consultar_deuda: ante la duda, NO pisar.
                if es_representado and datos.get("cuit") != objetivo:
                    return {}
                # Confirmamos monotributista SÓLO si el portal mostró datos REALES (una categoría).
                # Que abra "monotributo.afip" NO alcanza: para un no-adherido AFIP igual abre la
                # pantalla de adhesión (sin categoría). Antes acá se hardcodeaba True y eso rotulaba
                # como monotributista a CUALQUIERA cuyo portal abriera —p. ej. una docente en
                # relación de dependencia que no emite nada—. Sin categoría dejamos el régimen SIN
                # DETERMINAR (no devolvemos es_monotributista) y que lo infiera por los comprobantes
                # emitidos (clase C → monotributo). Ver schemas.resolver_regimen / clasificar_regimen.
                if datos.get("categoria"):
                    datos["es_monotributista"] = True
                    try:  # estado de cuota real (CCMA): al día / con deuda. No frena si falla.
                        datos.update(ccma.estado_cuota(mt, ctx))
                    except Exception:  # noqa: BLE001
                        pass
                return datos
            finally:
                ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
