"""
Prueba de emisión en HOMOLOGACIÓN: verifica que el cert y la clave sean pareja y emite una
Factura C de prueba (a consumidor final) usando el motor `emitir_comprobante_c`.

Lee las rutas del .env (ARCA_HOMO_CERT_PATH / ARCA_HOMO_KEY_PATH / ARCA_HOMO_CUIT).
Uso:  python scripts/probar_emision_homo.py [importe]
"""
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402

from app.config import settings  # noqa: E402
from app.arca import wsfev1  # noqa: E402

importe = float(sys.argv[1]) if len(sys.argv) > 1 else 1000.0

cert_path = settings.arca_homo_cert_path
key_path = settings.arca_homo_key_path
cuit = settings.arca_homo_cuit
print(f"CUIT emisor: {cuit}  |  PV: {settings.arca_homo_punto_venta}  |  importe: {importe}")

cert_bytes = Path(cert_path).read_bytes()
key_bytes = Path(key_path).read_bytes()

# 1) ¿El cert y la clave son pareja?
cert = x509.load_pem_x509_certificate(cert_bytes)
key = serialization.load_pem_private_key(key_bytes, password=None)
match = cert.public_key().public_numbers() == key.public_key().public_numbers()
print(f"Cert ↔ clave coinciden: {match}")
print(f"Subject del cert: {cert.subject.rfc4514_string()}")
if not match:
    print("⚠️  El certificado y la clave NO son pareja. No tiene sentido seguir.")
    sys.exit(1)

# 2) Emitir Factura C de prueba (consumidor final).
print("\nEmitiendo Factura C de prueba en homologación…")
try:
    res = wsfev1.emitir_comprobante_c(
        cuit,
        cert_bytes,
        key_bytes,
        cbte_tipo=11,  # Factura C
        punto_venta=settings.arca_homo_punto_venta,
        importe_total=importe,
        concepto=1,  # productos
        doc_tipo=99,  # consumidor final
        doc_nro="0",
        homo=True,
    )
    print("\n✅ EMITIDO OK")
    for k, v in res.items():
        print(f"   {k}: {v}")
except wsfev1.FacturacionError as e:
    print("\n❌ ARCA RECHAZÓ el comprobante:")
    print(f"   mensaje: {e}")
    print(f"   errores: {e.errores}")
    print(f"   observaciones: {e.observaciones}")
except Exception as e:  # noqa: BLE001
    print(f"\n❌ ERROR ({type(e).__name__}): {e}")
