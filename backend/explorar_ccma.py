"""Explora la CCMA a fondo: P01 (página principal, posible resumen de saldo) y el cálculo de deuda
con el botón real (manejando los alert de validación). Loguea todas las pestañas y el texto visible."""
import re
import shutil
import tempfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from app import models
from app.crypto import descifrar
from app.db import SessionLocal
from app.scraping import _comun, padron

CUIT = "20217168652"
OUT = Path("data/explora")
OUT.mkdir(parents=True, exist_ok=True)
BASE = "https://servicios2.afip.gob.ar/tramites_con_clave_fiscal/ccam/"

db = SessionLocal()
cont = db.get(models.Contador, CUIT)
clave = descifrar(cont.clave_cifrada).decode()
db.close()


def ascii_(s: str) -> str:
    return (s or "").encode("ascii", "replace").decode()


def guardar(page, nombre):
    try:
        (OUT / f"{nombre}.html").write_text(page.content(), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        print("  error:", ascii_(str(e)))


def ccma_tab(ctx):
    return next((p for p in ctx.pages if "ccam" in p.url.lower()), None)


perfil = tempfile.mkdtemp(prefix="diag_ccma_")
try:
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=True, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        _comun.login(page, CUIT, clave)
        mt = padron._abrir_monotributo(page, ctx)
        mt.wait_for_timeout(2000)
        mt.get_by_text(re.compile("Ver Saldo", re.I)).first.click()
        mt.wait_for_timeout(7000)
        ccma = ccma_tab(ctx)
        if ccma is None:
            print("NO se abrió la CCMA")
        else:
            ccma.on("dialog", lambda d: (print("DIALOG:", ascii_(d.message)), d.accept()))

            # 1) Página principal P01 (posible resumen / saldo)
            ccma.goto(BASE + "P01_ctacte.asp")
            ccma.wait_for_timeout(3500)
            guardar(ccma, "ccma_P01")
            print("===== P01 (pagina principal) =====")
            print(ascii_(ccma.inner_text("body"))[:2800])

            # 2) Cálculo de deuda con el botón real
            ccma.goto(BASE + "P02_ctacte.asp")
            ccma.wait_for_timeout(2500)
            try:
                ccma.locator("input[name='CalDeud']").click()
                ccma.wait_for_timeout(9000)
            except Exception as e:  # noqa: BLE001
                print("error click CalDeud:", ascii_(str(e)))
            print("\n===== Pestanas tras el calculo =====")
            for i, pg in enumerate(ctx.pages):
                print(f"  tab {i}: {pg.url}")
                if "ccam" in pg.url.lower():
                    guardar(pg, f"ccma_calc_{i}")
                    print(f"  --- texto tab {i} ---")
                    print(ascii_(pg.inner_text("body"))[:2800])
        ctx.close()
finally:
    shutil.rmtree(perfil, ignore_errors=True)
print("LISTO")
