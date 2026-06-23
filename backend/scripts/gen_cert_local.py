"""
Genera el certificado de facturación de un cliente EN LOCAL (corre el bootstrap con la clave del
cliente guardada en la DB local) y guarda cert + clave en archivos temporales para subirlos a prod.

Pensado para destrabar el piloto sin depender de la CPU del VPS: la parte lenta (scraping) corre acá.

Uso:  python scripts/gen_cert_local.py <CUIT>
Salida: %TEMP%/cert_<cuit>.pem  y  %TEMP%/key_<cuit>.pem
"""
import os
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal  # noqa: E402
from app import models  # noqa: E402
from app.crypto import descifrar  # noqa: E402
from app.scraping import bootstrap  # noqa: E402

cuit = sys.argv[1] if len(sys.argv) > 1 else "20454948301"

db = SessionLocal()
cli = db.get(models.ClienteARCA, cuit)
if cli is None:
    print(f"❌ El cliente {cuit} no está en la DB local.")
    sys.exit(1)
cont = db.get(models.Contador, cli.cuit_contador)
if cont is None:
    print(f"❌ El cliente {cuit} no tiene credencial (Contador) guardada.")
    sys.exit(1)

clave = descifrar(cont.clave_cifrada).decode()
print(f"Cliente: {cli.nombre} ({cuit}) · login con credencial {cli.cuit_contador}")
print("Generando certificado (scraping)… puede tardar ~1 min.\n")


def prog(pct: int, msg: str) -> None:
    print(f"  [{pct:>3}%] {msg}")


# headless=False: navegador VISIBLE. Mucho más confiable con las animaciones (Scriptaculous) de AFIP
# que disparan el ElementNotStableError en headless. Se abre una ventana en la máquina local.
# Alias FRESCO para no chocar con los huérfanos ya registrados (orbita/orbita2 del VPS).
# Se puede pasar por 2do argumento; default 'orbitafac'.
alias_base = sys.argv[2] if len(sys.argv) > 2 else "orbitafac"
print(f"Alias base: {alias_base}")
cert_pem, key_pem = bootstrap.bootstrap_cliente(
    cuit_cliente=cuit,
    cuit_login=cli.cuit_contador,
    clave=clave,
    alias=alias_base,
    on_progress=prog,
    headless=False,
)

tmp = Path(os.environ.get("TEMP", "/tmp"))
cert_file = tmp / f"cert_{cuit}.pem"
key_file = tmp / f"key_{cuit}.pem"
cert_file.write_bytes(cert_pem)
key_file.write_bytes(key_pem)

print(f"\n✅ OK")
print(f"   cert: {cert_file} ({len(cert_pem)} bytes)")
print(f"   key:  {key_file} ({len(key_pem)} bytes)")
