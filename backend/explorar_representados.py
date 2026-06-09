"""Explora a quién representa el contador en Mis Comprobantes (seleccionIngreso.do)."""
import re
import shutil
import sys
import tempfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from app.config import BASE_DIR
from app.scraping import _comun


def fes_tab(ctx):
    return next((p for p in ctx.pages if "fes.afip" in p.url or "mcmp" in p.url), None)


def main():
    cuit, clave = sys.argv[1], sys.argv[2]
    diag = BASE_DIR / "data" / "explora"
    diag.mkdir(parents=True, exist_ok=True)
    perfil = tempfile.mkdtemp(prefix="orbita_rep_")
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=True, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            print("[1] login...", flush=True)
            _comun.login(page, cuit, clave)
            print("[2] Mis Comprobantes...", flush=True)
            page.goto(_comun.PORTAL)
            page.wait_for_load_state("networkidle")
            b = page.locator("#buscadorInput")
            b.wait_for(state="visible", timeout=20000)
            b.click()
            b.fill("")
            b.press_sequentially("Mis Comprobantes", delay=80)
            page.wait_for_timeout(2500)
            page.locator('li[role="option"]').filter(has_text=re.compile("Mis Comprobantes", re.I)).first.click()
            page.wait_for_timeout(6000)
            _comun.click_continuar_si_aparece(ctx)
            page.wait_for_timeout(2500)
            fes = fes_tab(ctx)
            if fes is None:
                print("no abrió fes/mcmp. URLs:", [p.url for p in ctx.pages], flush=True)
                return
            print("    url:", fes.url, flush=True)
            print("[3] seleccionIngreso.do (cambiar persona representada)...", flush=True)
            fes.goto("https://fes.afip.gob.ar/mcmp/jsp/seleccionIngreso.do")
            fes.wait_for_timeout(3500)
            (diag / "rep_seleccion.html").write_text(fes.content(), encoding="utf-8")
            fes.screenshot(path=str(diag / "rep_seleccion.png"), full_page=True)
            print("    url:", fes.url, flush=True)
            txt = " ".join(fes.inner_text("body").split())
            print("    texto:", txt[:600].encode("ascii", "replace").decode(), flush=True)
            # opciones de un posible <select> o links de representados
            sels = fes.eval_on_selector_all("select option", "els=>els.map(e=>e.textContent.trim()).filter(Boolean)")
            print("    options:", sels[:25], flush=True)
        except Exception as e:  # noqa: BLE001
            print("ERROR", type(e).__name__, str(e)[:200], flush=True)
        finally:
            ctx.close()
            shutil.rmtree(perfil, ignore_errors=True)


main()
