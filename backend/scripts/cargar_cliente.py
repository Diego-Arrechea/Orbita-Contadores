"""
cargar_cliente.py — registra AV INGENIERIA en la DB con su cert/key CIFRADOS.

Es el puente entre el spike manual (cert ya generado/descargado) y el backend. One-shot:

    cd backend
    .venv\\Scripts\\python -m scripts.cargar_cliente

En producción esto será un endpoint de onboarding; por ahora son paths fijos del cliente
de prueba. El cert elegido es el CN=orbita (serial 4007f92e...), el que está ASOCIADO al WS.
"""
from __future__ import annotations

from pathlib import Path

from app import models
from app.crypto import cifrar
from app.db import Base, SessionLocal, engine

CUIT = "30715434233"
NOMBRE = "AV INGENIERIA S.R.L."
CERT = Path(r"C:/Users/usuario/Downloads/orbita_4007f92e414b880a.crt")
KEY = Path(
    r"C:/Users/usuario/Desktop/Diego/Orbita-Contadores/research/arca/camino_b_scraping/30715434233_orbita.key"
)


def main() -> None:
    Base.metadata.create_all(bind=engine)
    if not CERT.exists():
        raise SystemExit(f"No existe el certificado: {CERT}")
    if not KEY.exists():
        raise SystemExit(f"No existe la clave privada: {KEY}")

    cert_cif = cifrar(CERT.read_bytes())
    key_cif = cifrar(KEY.read_bytes())

    db = SessionLocal()
    try:
        cliente = db.get(models.ClienteARCA, CUIT)
        if cliente:
            cliente.nombre = NOMBRE
            cliente.cert_cifrado = cert_cif
            cliente.key_cifrado = key_cif
            accion = "actualizado"
        else:
            db.add(
                models.ClienteARCA(
                    cuit=CUIT, nombre=NOMBRE, cert_cifrado=cert_cif, key_cifrado=key_cif
                )
            )
            accion = "creado"
        db.commit()
        print(f"Cliente {accion}: {CUIT} — {NOMBRE} (cert/key cifrados)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
