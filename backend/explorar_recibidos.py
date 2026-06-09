"""Exploración de 'Mis Comprobantes > Recibidos': descubre el form (id de fecha) y el CSV."""
import io
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from app.config import BASE_DIR
from app.scraping import _comun


def mcmp_tab(ctx):
    return next((p for p in ctx.pages if "mcmp" in p.url), None)


def main():
    cuit, clave = sys.argv[1], sys.argv[2]
    diag = BASE_DIR / "data" / "explora"
    diag.mkdir(parents=True, exist_ok=True)
    perfil = tempfile.mkdtemp(prefix="orbita_rec_")
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=True, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            print("[1] login...", flush=True)
            _comun.login(page, cuit, clave)
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
            print("[2] Recibidos...", flush=True)
            mcmp.locator("#btnRecibidos").first.click()
            mcmp.wait_for_timeout(6000)
            mcmp = mcmp_tab(ctx) or mcmp
            (diag / "recibidos_form.html").write_text(mcmp.content(), encoding="utf-8")
            ids = mcmp.eval_on_selector_all("input", "els => els.map(e=>e.id).filter(Boolean)")
            print("    inputs id:", ids, flush=True)
            fid = "fechaEmision" if "fechaEmision" in ids else next((i for i in ids if "fecha" in i.lower()), None)
            print("    fecha id:", fid, flush=True)
            mcmp.evaluate(f"(v)=>{{var e=document.getElementById('{fid}'); if(e) e.value=v;}}", "01/06/2025 - 31/05/2026")
            mcmp.get_by_role("button", name=re.compile("buscar", re.I)).first.click()
            try:
                mcmp.get_by_text(re.compile("total de", re.I)).first.wait_for(timeout=90000)
                print("    ", mcmp.get_by_text(re.compile("total de", re.I)).first.inner_text().strip(), flush=True)
            except Exception:
                mcmp.wait_for_timeout(8000)
            btn = mcmp.get_by_text("CSV", exact=True).first
            btn.wait_for(state="visible", timeout=30000)
            mcmp.wait_for_timeout(1000)
            with mcmp.expect_download(timeout=60000) as dl:
                btn.click()
            zb = Path(dl.value.path()).read_bytes()
            (diag / "recibidos.csv").write_bytes(zb)
            z = zipfile.ZipFile(io.BytesIO(zb))
            csvname = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
            txt = z.read(csvname).decode("utf-8-sig")
            ln = txt.splitlines()
            print("=== CABECERA ===", flush=True)
            print(ln[0].encode("ascii", "replace").decode(), flush=True)
            if len(ln) > 1:
                print("=== FILA 1 ===", flush=True)
                print(ln[1].encode("ascii", "replace").decode(), flush=True)
        except Exception as e:
            print("ERROR", type(e).__name__, str(e)[:200], flush=True)
            m = mcmp_tab(ctx)
            if m:
                m.screenshot(path=str(diag / "recibidos_err.png"), full_page=True)
        finally:
            ctx.close()
            shutil.rmtree(perfil, ignore_errors=True)


main()
