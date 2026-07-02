"""
Baja SOLO el .crt de un alias ya creado y asociado (sin rehacer A/B). No interactivo.
Habilita descargas en el contexto (accept_downloads) y usa timeout largo.

Uso:  python scripts/bajar_cert.py <CUIT> <ALIAS>
Salida: %TEMP%/cert_<cuit>.pem
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cloakbrowser import launch_persistent_context  # noqa: E402
from app.scraping import _comun  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app import models  # noqa: E402
from app.crypto import descifrar  # noqa: E402

cuit = sys.argv[1] if len(sys.argv) > 1 else "20454948301"
alias = sys.argv[2] if len(sys.argv) > 2 else "orbitafac"

db = SessionLocal()
cli = db.get(models.ClienteARCA, cuit)
cred = db.get(models.CredencialARCA, cli.cuit_credencial)
clave = descifrar(cred.clave_cifrada).decode()
cuit_login = cli.cuit_credencial
print(f"Bajando cert del alias '{alias}' de {cuit} (login {cuit_login})…")

perfil = tempfile.mkdtemp(prefix="orbita_dl_")
try:
    ctx = launch_persistent_context(
        user_data_dir=perfil,
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
        accept_downloads=True,  # <- la pieza que faltaba para que expect_download dispare
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    _comun.login(page, cuit_login, clave)
    page = _comun.ir_a_certificados(ctx, page)
    _comun.seleccionar_contribuyente(page, cuit)
    page.wait_for_timeout(2500)

    filas = page.locator("tr")
    idx = None
    for i in range(filas.count()):
        partes = " ".join((filas.nth(i).inner_text() or "").split()).split()
        if partes and partes[0] == alias:
            idx = i
            break
    if idx is None:
        print(f"❌ No encontré el alias '{alias}' en la lista de certificados.")
        sys.exit(1)

    fila = filas.nth(idx)
    ver = fila.get_by_role("link", name="Ver")
    if ver.count() == 0:
        ver = fila.locator(
            "a:has-text('Ver'), input[type='image'][alt*='Ver' i], "
            "input[type='image'][src*='ver' i], a[href*='etalle' i]"
        )
    _comun.click_robusto(page, ver.first)
    page.wait_for_timeout(2500)

    SEL = (
        "input[type='image'][alt*='Descargar' i], input[type='image'][src*='descargar' i], "
        "a:has-text('Descargar')"
    )
    page = _comun.esperar_en_pestanas(ctx, SEL, 20000) or page
    with page.expect_download(timeout=90000) as dl:
        _comun.click_robusto(page, page.locator(SEL).first)

    dest = Path(os.environ.get("TEMP", "/tmp")) / f"cert_{cuit}.pem"
    dl.value.save_as(str(dest))
    print(f"\n✅ Cert descargado: {dest} ({dest.stat().st_size} bytes)")
finally:
    try:
        ctx.close()
    except Exception:
        pass
    shutil.rmtree(perfil, ignore_errors=True)
