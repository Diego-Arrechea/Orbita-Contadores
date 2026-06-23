"""
Genera el par (clave privada + CSR) para pedirle a AFIP un certificado.

Sirve tanto para homologación (entorno de pruebas) como para producción: el CSR es igual; lo que
cambia es el portal donde lo subís (WSASS = homologación). Usa el mismo formato de subject que el
bootstrap del proyecto (C=AR, O=ORBITA, CN=<alias>, serialNumber='CUIT <cuit>').

Uso:
    python scripts/generar_csr_homo.py <CUIT_sin_guiones> [alias]

Genera dos archivos en backend/:
    homo_<cuit>.key  → CLAVE PRIVADA. NO se sube a ningún lado. Guardala (la vas a necesitar para emitir).
    homo_<cuit>.csr  → esto es lo que subís a AFIP (WSASS) para que te devuelva el .crt.

Después, en backend/.env:
    ARCA_HOMO_CERT_PATH=/ruta/al/certificado_que_te_dio_afip.crt
    ARCA_HOMO_KEY_PATH=/ruta/al/homo_<cuit>.key
    ARCA_HOMO_CUIT=<cuit>
"""
import sys
from pathlib import Path

# La consola de Windows (cp1252) no encodea algunos caracteres; forzamos UTF-8 para el output.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 — entorno sin reconfigure: seguimos igual
    pass

# Permite correr el script desde backend/ sin instalar el paquete.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.scraping.bootstrap import generar_csr  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python scripts/generar_csr_homo.py <CUIT_sin_guiones> [alias]")
        sys.exit(1)
    cuit = "".join(c for c in sys.argv[1] if c.isdigit())
    if len(cuit) != 11:
        print(f"CUIT inválido: '{sys.argv[1]}' (esperaba 11 dígitos).")
        sys.exit(1)
    alias = sys.argv[2] if len(sys.argv) > 2 else "orbita"

    key_pem, csr_pem = generar_csr(cuit, alias)

    base = Path(__file__).resolve().parent.parent
    key_file = base / f"homo_{cuit}.key"
    csr_file = base / f"homo_{cuit}.csr"
    key_file.write_bytes(key_pem)
    csr_file.write_bytes(csr_pem)

    print("Listo. Generé:")
    print(f"  CLAVE PRIVADA (guardala, NO la subas): {key_file}")
    print(f"  CSR (subí ESTE a AFIP/WSASS):          {csr_file}")
    print()
    print("Pasos:")
    print("  1. Subí el .csr en el portal de homologación de AFIP (WSASS) → te devuelve un .crt.")
    print("  2. En backend/.env seteá:")
    print(f"       ARCA_HOMO_CERT_PATH=<ruta al .crt que te dio AFIP>")
    print(f"       ARCA_HOMO_KEY_PATH={key_file}")
    print(f"       ARCA_HOMO_CUIT={cuit}")
    print("  3. Habilitá ese CUIT para el WS 'wsfe' (Facturación Electrónica) en homologación.")


if __name__ == "__main__":
    main()
