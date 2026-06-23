"""
abrir_arca.py — abre un Chromium VISIBLE, loguea en ARCA con la clave del contador y te deja el
portal abierto para que navegues a MANO (Mis Comprobantes / Comprobantes en Línea / etc.).

Pensado para análisis manual: la app no interviene, sólo te ahorra el login.

SEGURIDAD: la clave NO se guarda ni se muestra ni se loguea. Se pide por prompt OCULTO (getpass)
al ejecutar, vive sólo en memoria del proceso y se descarta al cerrar. No queda en el historial
de la terminal ni en ningún archivo.

Uso (desde la carpeta backend/, con el venv del proyecto):
    .venv\\Scripts\\python -m scripts.abrir_arca

Te pide:
  - CUIT del contador (el que loguea en ARCA)
  - Clave fiscal del contador (entrada oculta)
Abre el navegador, loguea y queda esperando. Cuando termines de mirar, volvé a la terminal y
apretá Enter para cerrarlo.

Para ver a un REPRESENTADO (ej. SCARFONE, CUIT 27-22598598-2): entrás con la clave del CONTADOR y,
ya adentro del servicio (Mis Comprobantes tiene un selector de CUIT arriba), elegís a la persona.

Si falla con "executable doesn't exist" (navegador de Patchright no instalado localmente):
    .venv\\Scripts\\patchright install chromium
"""
from __future__ import annotations

import getpass
import tempfile

from patchright.sync_api import sync_playwright

from app.scraping import _comun

CUIT_OBJETIVO = "27225985982"  # SCARFONE SILVIA VERONICA (sólo informativo, para el recordatorio)


def main() -> None:
    cuit_raw = input("CUIT del contador (solo números): ").strip()
    cuit = "".join(c for c in cuit_raw if c.isdigit())
    clave = getpass.getpass("Clave fiscal del contador (no se muestra): ")
    if len(cuit) != 11 or not clave:
        raise SystemExit("Datos incompletos: el CUIT son 11 dígitos y la clave no puede ir vacía.")

    perfil = tempfile.mkdtemp(prefix="orbita_arca_manual_")
    print("Abriendo Chromium y logueando en ARCA… (puede tardar unos segundos)")
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=False, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        _comun.login(page, cuit, clave)
        page.goto(_comun.PORTAL)
        _comun.esperar_idle(page)
        print()
        print("=" * 66)
        print(" Sesión abierta en ARCA. Navegá a mano desde el portal.")
        print(f" Para ver a SCARFONE (CUIT {CUIT_OBJETIVO}): elegila en el selector")
        print(" de CUIT/representado dentro del servicio que abras (Mis Comprobantes,")
        print(" Comprobantes en Línea, etc.).")
        print("=" * 66)
        try:
            input(" >> Cuando termines, apretá Enter acá para cerrar el navegador… ")
        finally:
            ctx.close()


if __name__ == "__main__":
    main()
