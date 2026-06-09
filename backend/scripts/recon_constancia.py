"""
RECON (descartable) de la Constancia de Inscripción de ARCA.

Objetivo: ABRIR el servicio 'Constancia de Inscripción' del portal con tu clave y VOLCAR el HTML
+ screenshot de lo que cargue, para que el parser (extraer_constancia) se escriba contra el markup
REAL — no a ciegas. NO toca la DB ni persiste nada; la clave se usa y se descarta.

Corré headful (ventana real; el login de ARCA necesita sesión de escritorio) desde backend/:

    .venv\\Scripts\\python -m scripts.recon_constancia <cuit_login> <clave> [cuit_objetivo]

Ejemplos (corré los TRES casos para tener las tres formas de régimen):
    ... 20446503570 TU_CLAVE                 # vos (no_monotributo)
    ... 20446503570 TU_CLAVE 30715434233     # AV INGENIERIA (RI, representado)
    ... 20446503570 TU_CLAVE 20217168652     # CHANTIRI (monotributo, representado)

Salida en backend/data/diag/constancia_<objetivo>_<n>.html / .png  + por consola las OPCIONES del
buscador (el nombre/aria-label EXACTO del servicio) y las URLs abiertas. Pasame esos .html.
"""
from __future__ import annotations

import pathlib
import re
import shutil
import sys
import tempfile

from patchright.sync_api import sync_playwright

from app.scraping import _comun


def main() -> None:
    if len(sys.argv) < 3:
        print("uso: python -m scripts.recon_constancia <cuit_login> <clave> [cuit_objetivo]")
        raise SystemExit(2)
    cuit_login, clave = sys.argv[1], sys.argv[2]
    objetivo = sys.argv[3] if len(sys.argv) > 3 else cuit_login

    outdir = pathlib.Path("data/diag")
    outdir.mkdir(parents=True, exist_ok=True)
    perfil = tempfile.mkdtemp(prefix="orbita_const_")  # perfil LIMPIO: evita contexto residual
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless=False, user_data_dir=perfil)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            _comun.login(page, cuit_login, clave)

            # Abrir el buscador del portal y tipear "constancia".
            page.goto(_comun.PORTAL)
            _comun.esperar_idle(page)
            b = page.locator("#buscadorInput")
            b.wait_for(state="visible", timeout=20000)
            b.click()
            b.fill("")
            b.press_sequentially("constancia", delay=80)
            page.wait_for_timeout(3000)

            # Imprimir TODAS las opciones del typeahead (revela el nombre/aria-label exacto).
            opciones = page.locator('li[role="option"]')
            for i in range(opciones.count()):
                o = opciones.nth(i)
                print(f"OPCION[{i}] aria={o.get_attribute('aria-label')!r} txt={(o.inner_text() or '').strip()!r}")

            # Clickear la que diga 'constancia' (la primera que matchee).
            opciones.filter(has_text=re.compile("constancia", re.I)).first.click()
            page.wait_for_timeout(8000)
            _comun.click_continuar_si_aparece(ctx)
            page.wait_for_timeout(3000)

            # Si aparece el combo de "actuar en representación", elegir el CUIT objetivo.
            combo = _comun.pagina_con(ctx, "#tblAutoridadAplicacion_cmbCont")
            if combo is not None:
                _comun.seleccionar_contribuyente(combo, objetivo)
                page.wait_for_timeout(3000)

            # Volcar TODAS las pestañas (la constancia puede abrirse en otra pestaña o como PDF).
            for i, pg in enumerate(list(ctx.pages)):
                try:
                    print(f"PESTAÑA[{i}] url={pg.url}")
                    (outdir / f"constancia_{objetivo}_{i}.html").write_text(
                        pg.content(), encoding="utf-8"
                    )
                    pg.screenshot(path=str(outdir / f"constancia_{objetivo}_{i}.png"), full_page=True)
                except Exception as e:  # noqa: BLE001
                    print(f"  (no se pudo volcar la pestaña {i}: {e} — ¿descargó un PDF?)")

            print(f"\nListo. Revisá {outdir.resolve()} y pasame los .html.")
            ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)


if __name__ == "__main__":
    main()
