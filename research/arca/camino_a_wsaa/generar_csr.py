"""
Genera la clave privada + el CSR para tramitar el certificado de ARCA.
NO requiere OpenSSL (usa la librería cryptography). Te pide el CUIT.

Crea 2 archivos en esta carpeta:
  clave.key  → tu clave privada  (¡guardala bien — NUNCA al repo, ya está en .gitignore!)
  pedido.csr → el CSR que vas a subir en el portal de ARCA

Después: subí `pedido.csr` en ARCA → "Administrador de Certificados Digitales" → bajás el .crt.

Uso:  python generar_csr.py
"""
from __future__ import annotations

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def main() -> None:
    cuit = input("CUIT (solo números, 11 dígitos): ").strip()
    org = input("Nombre / razón social [ORBITA]: ").strip() or "ORBITA"
    alias = input("Alias del certificado [orbita]: ").strip() or "orbita"

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with open("clave.key", "wb") as f:
        f.write(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            )
        )

    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COUNTRY_NAME, "AR"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
                    x509.NameAttribute(NameOID.COMMON_NAME, alias),
                    x509.NameAttribute(NameOID.SERIAL_NUMBER, f"CUIT {cuit}"),
                ]
            )
        )
        .sign(key, hashes.SHA256())
    )
    with open("pedido.csr", "wb") as f:
        f.write(csr.public_bytes(serialization.Encoding.PEM))

    print("\n✅ Generados en esta carpeta:")
    print("   - clave.key  (tu clave privada — guardala, no la compartas)")
    print("   - pedido.csr (subí ESTE archivo en el portal de ARCA)")


if __name__ == "__main__":
    main()
