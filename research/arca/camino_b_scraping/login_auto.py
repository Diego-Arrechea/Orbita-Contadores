"""
login_auto.py — Login AUTOMÁTICO a ARCA con CloakBrowser, usando los selectores reales.

Flujo (HTML confirmado por el usuario):
  https://auth.afip.gob.ar/contribuyente_/login.xhtml
    Pantalla 1: input #F1:username (CUIT) → submit #F1:btnSiguiente
    Pantalla 2: input #F1:password (clave) → submit #F1:btnIngresar

CloakBrowser maneja bien esta página (es JSF simple, no la SPA del portal que se colgaba).
Las credenciales se leen de credenciales_local.py (GITIGNORED).

Uso:  python login_auto.py
"""
from __future__ import annotations

from cloakbrowser import launch_persistent_context

try:
    from credenciales_local import CLAVE, CUIT
except ImportError:
    import getpass

    CUIT = input("CUIT: ").strip()
    CLAVE = getpass.getpass("Clave fiscal: ")

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"

# Selectores reales del formulario (el ':' de JSF se escapa con '\:')
SEL_USER = "#F1\\:username"
SEL_SIGUIENTE = "#F1\\:btnSiguiente"
SEL_PASS = "#F1\\:password"
SEL_INGRESAR = "#F1\\:btnIngresar"


def main() -> None:
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_login_test",
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        print("Abriendo el login de ARCA...")
        page.goto(LOGIN_URL)
        page.wait_for_load_state("networkidle")

        if page.locator(SEL_USER).first.is_visible():
            print(f"Pantalla 1: ingresando CUIT {CUIT}...")
            page.fill(SEL_USER, CUIT)
            page.click(SEL_SIGUIENTE)

            print("Esperando la pantalla de clave...")
            page.wait_for_selector(SEL_PASS, timeout=20000)
            print("Pantalla 2: ingresando la clave...")
            page.fill(SEL_PASS, CLAVE)
            page.click(SEL_INGRESAR)
            page.wait_for_load_state("networkidle")
        else:
            print("No apareció el campo CUIT — quizá ya había sesión iniciada.")

        print("\nURL final:", page.url)
        if "login" in page.url.lower() or "auth.afip" in page.url.lower():
            print("⚠️ Seguís en el login. Mirá si hay un mensaje de error (clave mal, etc.).")
        else:
            print("✅ Login OK — saliste de la pantalla de login.")
        input("\nENTER para cerrar... ")
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
