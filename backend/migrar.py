"""Migración NO destructiva de clientes_arca: agrega las columnas nuevas con ALTER TABLE ADD COLUMN
sin borrar datos. Idempotente (sólo agrega las que faltan). Correr tras cambiar el modelo."""
from sqlalchemy import text

from app.db import engine

NUEVAS = {
    "cuota_estado": "VARCHAR(12)",
    "cuota_deuda": "NUMERIC(15, 2)",
    "cuota_saldo_favor": "NUMERIC(15, 2)",
    "prox_venc_fecha": "VARCHAR(20)",
    "prox_venc_importe": "NUMERIC(15, 2)",
    "debito_automatico": "BOOLEAN",
}

with engine.begin() as con:
    cols = {row[1] for row in con.execute(text("PRAGMA table_info(clientes_arca)"))}
    for nombre, tipo in NUEVAS.items():
        if nombre in cols:
            print("ya existe:", nombre)
        else:
            con.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN {nombre} {tipo}"))
            print("agregada :", nombre)
print("OK")
