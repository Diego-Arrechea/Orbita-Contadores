"""
Login al portal de ARCA con clave fiscal, usando CloakBrowser (Chromium stealth).

CloakBrowser (https://github.com/CloakHQ/CloakBrowser) es un reemplazo drop-in de
Playwright con un Chromium parcheado a nivel C++ que pasa la detección de bots. Una vez
lanzado, se usa con la API normal de Playwright (page.goto, page.fill, page.request...).

⚠️ IMPORTANTE sobre el captcha: CloakBrowser NO resuelve captchas, los PREVIENE
(mejor score de reCAPTCHA v3 / Turnstile no-interactivo). Si ARCA fuerza un challenge
interactivo o pide 2FA (clave nivel 3/4), hay que intervenir a mano — por eso usamos
headless=False y un perfil persistente (para no re-loguear ni re-captchar cada vez).

⚠️ Selectores ILUSTRATIVOS: hay que inspeccionar el DOM real de auth.afip.gob.ar.
"""
from __future__ import annotations

from cloakbrowser import launch_persistent_context

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"


def abrir_sesion(
    perfil_dir: str = "./.perfil_arca",
    headless: bool = False,
    proxy: str | None = None,
):
    """
    Abre un contexto stealth con perfil PERSISTENTE: las cookies quedan en `perfil_dir`,
    así el segundo run no necesita re-loguear ni volver a pasar el captcha.

    Para ARCA conviene headless=False y, idealmente, un proxy residencial argentino
    (ej. proxy="http://user:pass@host:port"). Devuelve un BrowserContext de Playwright.
    """
    return launch_persistent_context(
        user_data_dir=perfil_dir,
        headless=headless,
        humanize=True,                              # mouse/teclado/scroll humano (anti-bot)
        proxy=proxy,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )


def _esta_logueado(page) -> bool:
    url = page.url.lower()
    return "login" not in url and "auth.afip" not in url


def login(ctx, cuit: str, clave_fiscal: str):
    """
    Loguea solo si hace falta: si el perfil ya tiene sesión activa, reusa la cookie.
    Devuelve una `page` ya autenticada.
    """
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(LOGIN_URL)
    if _esta_logueado(page):
        return page                                 # sesión persistida → ya adentro

    # Paso 1 — CUIT
    page.fill("input#F1\\:username", cuit)
    page.click("input#F1\\:btnSiguiente")
    # ⚠️ CloakBrowser baja la probabilidad de captcha; si igual aparece uno interactivo,
    #    con headless=False lo resolvés a mano y el flujo sigue solo.

    # Paso 2 — clave fiscal
    page.fill("input#F1\\:password", clave_fiscal)
    page.click("input#F1\\:btnIngresar")
    # ⚠️ 2FA: clave nivel 3/4 pide un código (app Mi AFIP / Token) — ingresarlo en la ventana.

    page.wait_for_load_state("networkidle")
    return page


def validar_credenciales(cuit: str, clave_fiscal: str, headless: bool = False) -> bool:
    """El login ES la validación: si salimos de la pantalla de login, las credenciales sirven."""
    ctx = abrir_sesion(headless=headless)
    try:
        page = login(ctx, cuit, clave_fiscal)
        return _esta_logueado(page)
    finally:
        ctx.close()


if __name__ == "__main__":
    import getpass

    cuit = input("CUIT: ").strip()
    clave = getpass.getpass("Clave fiscal: ")
    print("Credenciales válidas:", validar_credenciales(cuit, clave))
