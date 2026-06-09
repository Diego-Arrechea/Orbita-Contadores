"""
Navegación común de ARCA con Patchright (login, portal, Relaciones, Certificados).

Lo comparten `onboarding.py` (listar representados) y `bootstrap.py` (generar el cert).
Portado de research/arca/camino_b_scraping/bootstrap_certificado.py. La clave viene SIEMPRE
como parámetro y nunca se persiste.
"""
from __future__ import annotations

import time

from ..config import BASE_DIR

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
PORTAL = "https://portalcf.cloud.afip.gob.ar/portal/app/"

SEL_USER = "#F1\\:username"
SEL_SIGUIENTE = "#F1\\:btnSiguiente"
SEL_PASS = "#F1\\:password"
SEL_INGRESAR = "#F1\\:btnIngresar"

# El botón "Agregar alias" es <input type=image> con un GIF (alt vacío) → matchear por id/src.
SEL_AGREGAR = "#cmdIngresar, input[type='image'][src*='agregarAlias' i]"


def esperar_idle(page, timeout_ms: int = 12000) -> None:
    """networkidle TOLERANTE: ARCA mantiene conexiones abiertas y no siempre queda 'idle';
    esperamos un rato y seguimos sin colgar la navegación."""
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:  # noqa: BLE001
        pass


def crear_contexto(pw, headless: bool, user_data_dir: str):
    """Lanza el contexto stealth de Patchright en `user_data_dir`.

    OJO: usar un perfil LIMPIO (temporal) por operación. Un perfil compartido retiene el
    contexto 'actuando en representación de ...' de runs previos y arruina el bootstrap
    (genera el cert para el CUIT equivocado).
    """
    return pw.chromium.launch_persistent_context(
        user_data_dir=user_data_dir,
        headless=headless,
        locale="es-AR",
        timezone_id="America/Argentina/Buenos_Aires",
        no_viewport=True,
    )


def login(page, cuit: str, clave: str) -> None:
    page.goto(LOGIN_URL)
    esperar_idle(page)
    if not page.locator(SEL_USER).first.is_visible():
        return  # ya había sesión iniciada
    page.fill(SEL_USER, cuit)
    page.click(SEL_SIGUIENTE)
    page.wait_for_selector(SEL_PASS, timeout=20000)
    page.fill(SEL_PASS, clave)
    page.click(SEL_INGRESAR)
    esperar_idle(page)
    time.sleep(4)  # cadena de redirecciones hasta el portal


def pagina_con(ctx, selector: str):
    for p in ctx.pages:
        try:
            if p.locator(selector).count() > 0:
                return p
        except Exception:  # noqa: BLE001
            pass
    return ctx.pages[-1] if ctx.pages else None


def esperar_en_pestanas(ctx, selector: str, timeout_ms: int = 20000):
    for _ in range(max(1, int(timeout_ms / 500))):
        for pg in list(ctx.pages):
            try:
                if pg.locator(selector).count() > 0:
                    return pg
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return None


def esperar_primero(ctx, selectores: list[str], timeout_ms: int = 20000, intervalo_ms: int = 400):
    """Mira QUÉ hay en pantalla y decide: poll rápido sobre todas las pestañas, devuelve
    (selector, pagina) del PRIMER selector VISIBLE de la lista, o (None, None) si ninguno
    aparece. Sirve para ramificar el flujo según el estado real (no esperar a ciegas)."""
    for _ in range(max(1, int(timeout_ms / intervalo_ms))):
        for pg in list(ctx.pages):
            for sel in selectores:
                try:
                    loc = pg.locator(sel).first
                    if loc.count() > 0 and loc.is_visible():
                        return sel, pg
                except Exception:  # noqa: BLE001
                    pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(intervalo_ms)
    return None, None


def click_continuar_si_aparece(ctx, timeout_ms: int = 3000) -> bool:
    for _ in range(max(1, int(timeout_ms / 500))):
        for pg in list(ctx.pages):
            try:
                btn = pg.get_by_role("button", name="Continuar")
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click()
                    pg.wait_for_timeout(1000)  # no networkidle: serviciosweb no queda "idle"
                    return True
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return False


def click_robusto(page, loc) -> None:
    """Click tolerante a la verificación de estabilidad de humanize (CloakBrowser).

    ARCA carga banners/notificaciones (Domicilio Fiscal Electrónico, "No tenés notificaciones",
    etc.) DESPUÉS del `networkidle`, lo que reflowea la página y mueve los botones. humanize
    aborta el click si el elemento "se sigue moviendo" (ElementNotStableError). Acá lo traemos a
    la vista, intentamos el click humano y, si falla, caemos a un click por JS que dispara el
    onclick/postback igual (sin mouse ni chequeo de estabilidad). `loc` es un Locator resuelto.
    """
    loc.wait_for(state="visible", timeout=15000)
    try:
        loc.scroll_into_view_if_needed(timeout=5000)
    except Exception:  # noqa: BLE001
        try:
            loc.evaluate("el => el.scrollIntoView({block: 'center'})")
        except Exception:  # noqa: BLE001
            pass
    page.wait_for_timeout(500)
    try:
        loc.click(timeout=8000)
    except Exception:  # noqa: BLE001  (ElementNotStableError u otros transitorios de humanize)
        loc.evaluate("el => el.click()")


def buscar_servicio(ctx, page, texto: str, aria_label: str, detector: str):
    """Busca el servicio en el portal (#buscadorInput, typeahead) y lo abre. Navegar desde el
    portal es lo que autoriza la sesión en serviciosweb."""
    page.goto(PORTAL)
    esperar_idle(page)
    buscador = page.locator("#buscadorInput")
    buscador.wait_for(state="visible", timeout=20000)
    buscador.click()
    buscador.fill("")
    buscador.press_sequentially(texto, delay=80)
    opcion = page.locator(f'li[role="option"][aria-label*="{aria_label}" i]').first
    opcion.wait_for(state="visible", timeout=10000)
    opcion.click()
    # NO esperamos networkidle: serviciosweb mantiene conexiones abiertas y nunca queda "idle"
    # (colgaba ~30s). El polling del `detector` confirma que la pantalla cargó.
    click_continuar_si_aparece(ctx)
    return esperar_en_pestanas(ctx, detector, 20000)


def ir_a_relaciones(ctx, page):
    """El combo de Autoridad de Aplicación aparece ANTES que #cmdAgregarServicio → detectamos
    cualquiera de los dos."""
    detector = "#tblAutoridadAplicacion_cmbCont, #cmdAgregarServicio"
    for _ in (1, 2):
        try:
            p = buscar_servicio(ctx, page, "relaciones", "Relaciones", detector)
            if p is not None:
                return p
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError("No se pudo abrir el Administrador de Relaciones.")


def ir_a_certificados(ctx, page):
    """Abre 'Administración de Certificados Digitales' (detecta el botón Agregar alias)."""
    for _ in (1, 2):
        try:
            p = buscar_servicio(ctx, page, "digitales", "Certificados Digitales", SEL_AGREGAR)
            if p is not None:
                return p
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError("No se pudo abrir 'Administración de Certificados Digitales'.")


def seleccionar_contribuyente(page, cuit: str) -> None:
    """Si aparece el combo de Autoridad de Aplicación, elige el CUIT que estamos procesando
    (su `value` es el CUIT). Idempotente: si no aparece, no hace nada."""
    sel = page.locator("#tblAutoridadAplicacion_cmbCont")
    try:
        if sel.count() > 0:
            sel.select_option(value=cuit)
            page.wait_for_timeout(1000)  # el combo dispara postback; no networkidle (no queda idle)
    except Exception:  # noqa: BLE001
        pass


def leer_nombre_navbar(page, clase: str) -> str | None:
    """Lee el nombre del contribuyente del navbar de los servicios de ARCA (framework AFIP):
    <strong class="text-primary">NOMBRE</strong> = usuario logueado,
    <strong class="text-success">NOMBRE</strong> = contribuyente representado (el de los datos).
    El [CUIT] queda fuera del <strong>. Devuelve el nombre normalizado o None si no está."""
    try:
        loc = page.locator(f"strong.{clase}").first
        if loc.count() > 0:
            txt = " ".join((loc.text_content() or "").split())
            return txt or None
    except Exception:  # noqa: BLE001
        pass
    return None


def leer_representados(page, cuit_login: str) -> list[dict]:
    """Lee las <option> del combo: value=CUIT, texto=nombre. Sin combo → solo el titular, con su
    nombre real tomado del navbar (si está); el sync luego lo confirma desde Mis Comprobantes."""
    sel = page.locator("#tblAutoridadAplicacion_cmbCont")
    reps: list[dict] = []
    if sel.count() > 0:
        for opt in sel.locator("option").all():
            val = (opt.get_attribute("value") or "").strip()
            if val.isdigit() and len(val) == 11:  # descarta "-- Seleccione --"
                reps.append({"cuit": val, "nombre": (opt.text_content() or "").strip()})
    if not reps:
        nombre = leer_nombre_navbar(page, "text-primary") or f"Titular {cuit_login}"
        reps = [{"cuit": cuit_login, "nombre": nombre}]
    return reps
