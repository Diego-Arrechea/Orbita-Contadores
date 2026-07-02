"""Explora el Estado de Cuenta del portal Monotributo (paso 3: estado de cuota real).
Login CHANTIRI, abre Monotributo, parsea el próximo vencimiento y hace 'Ver Saldo / Pagar' para
capturar el saldo/deuda. Guarda los HTML en data/explora/ para analizarlos."""
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

db = SessionLocal()
cred = db.get(models.CredencialARCA, CUIT)
clave = descifrar(cred.clave_cifrada).decode()
db.close()


def guardar(page, nombre):
    try:
        (OUT / f"{nombre}.html").write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(OUT / f"{nombre}.png"), full_page=True)
        print(f"  guardado {nombre}  url={page.url}")
    except Exception as e:  # noqa: BLE001
        print(f"  error guardando {nombre}: {e}")


perfil = tempfile.mkdtemp(prefix="diag_ec_")
try:
    with sync_playwright() as pw:
        ctx = _comun.crear_contexto(pw, headless=True, user_data_dir=perfil)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        _comun.login(page, CUIT, clave)
        mt = padron._abrir_monotributo(page, ctx)
        if mt is None:
            print("NO se abrió Monotributo")
        else:
            mt.wait_for_timeout(2500)
            guardar(mt, "ec_principal")
            html = mt.content()
            m = re.search(
                r"vencimiento es el\s*(.*?)\s*y el importe a pagar es\s*\$?\s*([\d\.,]+)", html, re.I
            )
            print("PROXIMO VENC:", m.group(1) if m else None, "| IMPORTE:", m.group(2) if m else None)
            print("DEBITO AUTOMATICO:", "débito automático" in html.lower())

            try:
                btn = mt.get_by_text(re.compile("Ver Saldo", re.I)).first
                btn.wait_for(state="visible", timeout=8000)
                print("click 'Ver Saldo / Pagar'...")
                btn.click()
                mt.wait_for_timeout(7000)
                for i, pg in enumerate(ctx.pages):
                    guardar(pg, f"ec_post_{i}")
            except Exception as e:  # noqa: BLE001
                print("error en Ver Saldo:", e)
        ctx.close()
finally:
    shutil.rmtree(perfil, ignore_errors=True)
print("LISTO")
