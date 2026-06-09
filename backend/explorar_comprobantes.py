"""
Exploración FINAL de 'Mis Comprobantes': login, Emitidos, setear rango de fechas, Buscar y
EXPORTAR el CSV — para ver el formato real y construir el parser.

Uso:  python explorar_comprobantes.py <CUIT> <CLAVE> [DESDE dd/mm/aaaa] [HASTA dd/mm/aaaa]
"""
import re
import shutil
import sys
import tempfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from app.config import BASE_DIR
from app.scraping import _comun


def mcmp_tab(ctx):
    return next((pg for pg in ctx.pages if "mcmp" in pg.url), None)


def main() -> None:
    cuit, clave = sys.argv[1].strip(), sys.argv[2]
    desde = sys.argv[3] if len(sys.argv) > 3 else "01/06/2025"
    hasta = sys.argv[4] if len(sys.argv) > 4 else "31/05/2026"
    diag = BASE_DIR / "data" / "explora"
    diag.mkdir(parents=True, exist_ok=True)
    perfil = tempfile.mkdtemp(prefix="orbita_expl_")
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
            page.wait_for_timeout(2000)
            mcmp = mcmp_tab(ctx)

            print("[3] Emitidos...", flush=True)
            mcmp.locator("#btnEmitidos").first.click()
            mcmp.wait_for_timeout(6000)
            mcmp = mcmp_tab(ctx) or mcmp
            mcmp.wait_for_timeout(1500)

            print(f"[4] fecha {desde} - {hasta} + Buscar...", flush=True)
            mcmp.wait_for_selector("#fechaEmision", timeout=15000)
            mcmp.evaluate("(v)=>{document.getElementById('fechaEmision').value=v;}", f"{desde} - {hasta}")
            mcmp.wait_for_timeout(500)
            mcmp.get_by_role("button", name=re.compile("buscar", re.I)).first.click()
            mcmp.wait_for_timeout(9000)
            mcmp = mcmp_tab(ctx) or mcmp
            (diag / "final.html").write_text(mcmp.content(), encoding="utf-8")
            mcmp.screenshot(path=str(diag / "final.png"), full_page=True)
            try:
                info = mcmp.locator("text=/total de/").first.inner_text()
                print("    registros:", info.strip(), flush=True)
            except Exception:  # noqa: BLE001
                pass

            print("[5] exportar CSV...", flush=True)
            try:
                with mcmp.expect_download(timeout=25000) as dl:
                    mcmp.get_by_text("CSV", exact=True).first.click()
                ruta = diag / "emitidos.csv"
                dl.value.save_as(str(ruta))
                print("    CSV:", ruta, ruta.stat().st_size, "bytes", flush=True)
                txt = ruta.read_text(encoding="latin-1", errors="replace")
                print("--- primeras 12 lineas ---", flush=True)
                for ln in txt.splitlines()[:12]:
                    print("   ", ln, flush=True)
            except Exception as e:  # noqa: BLE001
                print("    export CSV fallo:", str(e)[:160], flush=True)
            print("LISTO", flush=True)
        except Exception as e:  # noqa: BLE001
            print("ERROR:", type(e).__name__, str(e)[:200], flush=True)
            m = mcmp_tab(ctx)
            if m:
                m.screenshot(path=str(diag / "err.png"), full_page=True)
        finally:
            ctx.close()
            shutil.rmtree(perfil, ignore_errors=True)


if __name__ == "__main__":
    main()
