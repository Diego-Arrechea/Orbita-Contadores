"""Exploración de 'Constancia de inscripción' (padrón): categoría, actividad, fecha de inicio.
Uso: python explorar_constancia.py <CUIT_LOGIN> <CLAVE> [CUIT_A_CONSULTAR]"""
import re
import shutil
import sys
import tempfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from app.config import BASE_DIR
from app.scraping import _comun


def cap(ctx, diag, nombre):
    for i, pg in enumerate(ctx.pages):
        try:
            if "afip" not in pg.url and "arca" not in pg.url:
                continue
            (diag / f"{nombre}_{i}.html").write_text(pg.content(), encoding="utf-8")
            pg.screenshot(path=str(diag / f"{nombre}_{i}.png"), full_page=True)
            print(f"    cap {nombre}_{i}: {pg.url}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"    cap {nombre}_{i} fallo: {e}", flush=True)


def main():
    cuit, clave = sys.argv[1].strip(), sys.argv[2]
    consultar = sys.argv[3].strip() if len(sys.argv) > 3 else None
    diag = BASE_DIR / "data" / "explora"
    diag.mkdir(parents=True, exist_ok=True)
    perfil = tempfile.mkdtemp(prefix="orbita_pad_")
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=True, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            print("[1] login...", flush=True)
            _comun.login(page, cuit, clave)
            print("[2] buscar 'constancia'...", flush=True)
            page.goto(_comun.PORTAL)
            page.wait_for_load_state("networkidle")
            b = page.locator("#buscadorInput")
            b.wait_for(state="visible", timeout=20000)
            b.click()
            b.fill("")
            b.press_sequentially("constancia de inscrip", delay=80)
            page.wait_for_timeout(3500)
            ops = page.locator('li[role="option"]').all_text_contents()
            print("    opciones:", [o.strip()[:70] for o in ops][:12], flush=True)
            objetivo = page.locator('li[role="option"]').filter(has_text=re.compile("constancia", re.I)).first
            if objetivo.count() == 0:
                print("    NO hay 'Constancia' en el typeahead. (Mirá la lista de 'opciones' de arriba.)", flush=True)
                return
            print("    abriendo:", (objetivo.text_content() or "").strip()[:50], flush=True)
            objetivo.click()
            page.wait_for_timeout(6000)
            _comun.click_continuar_si_aparece(ctx)
            page.wait_for_timeout(3000)
            cap(ctx, diag, "constancia")
            # ¿hay un input para ingresar el CUIT a consultar?
            for pg in ctx.pages:
                if "afip" in pg.url or "arca" in pg.url:
                    ids = pg.eval_on_selector_all("input, select", "els => els.map(e=>e.id||e.name).filter(Boolean)")
                    print(f"    inputs/selects en {pg.url[-40:]}:", ids[:20], flush=True)
            print("LISTO -> data/explora/", flush=True)
        except Exception as e:  # noqa: BLE001
            print("ERROR", type(e).__name__, str(e)[:200], flush=True)
            cap(ctx, diag, "constancia_err")
        finally:
            ctx.close()
            shutil.rmtree(perfil, ignore_errors=True)


main()
