"""Valida la sync por Mis Comprobantes: registra contador + cliente y sincroniza (1 año)."""
from sqlalchemy import func, select

import app.models as models
from app.config import settings
from app.crypto import cifrar
from app.db import Base, SessionLocal, engine
from app.services import sincronizacion

settings.sync_anios_historico = 1  # validación rápida (1 ventana)

CONTADOR, CLAVE = "20259747504", "DaseMO2024"
CLIENTE, NOMBRE = "30715434233", "AV INGENIERIA S.R.L."

Base.metadata.create_all(engine)
db = SessionLocal()
if not db.get(models.Contador, CONTADOR):
    db.add(models.Contador(cuit=CONTADOR, clave_cifrada=cifrar(CLAVE.encode())))
if not db.get(models.ClienteARCA, CLIENTE):
    db.add(models.ClienteARCA(cuit=CLIENTE, nombre=NOMBRE, cuit_contador=CONTADOR))
db.commit()
print("contador + cliente OK. Sincronizando (1 anio)...", flush=True)


def prog(idx, n, msg):
    print(f"  ventana {idx + 1}/{n}: {msg}", flush=True)


n = sincronizacion.sincronizar(db, CLIENTE, on_progress=prog)
print("procesados:", n, flush=True)
for direc in ("emitido", "recibido"):
    cant = db.scalar(
        select(func.count()).select_from(models.ComprobanteEmitido).where(
            models.ComprobanteEmitido.cuit == CLIENTE, models.ComprobanteEmitido.direccion == direc
        )
    )
    print(f"{direc}s en la DB:", cant, flush=True)
    for c in db.scalars(
        select(models.ComprobanteEmitido)
        .where(models.ComprobanteEmitido.cuit == CLIENTE, models.ComprobanteEmitido.direccion == direc)
        .limit(2)
    ):
        print("   ", c.fecha, "tipo", c.cbte_tipo, c.punto_venta, c.numero, "$", c.imp_total, c.contraparte_nombre, flush=True)
db.close()
