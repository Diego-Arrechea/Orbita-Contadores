"""SQLAlchemy: engine, sesión y Base declarativa."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

# check_same_thread=False: SQLite + FastAPI (varios hilos) lo necesitan.
_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """Dependencia de FastAPI: una sesión por request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def asegurar_columnas() -> None:
    """Migración ligera (sin Alembic): agrega columnas nuevas a tablas ya existentes.
    create_all() crea tablas faltantes pero NO altera las existentes."""
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        # Si una tabla todavía no existe, create_all la crea con las columnas nuevas: por eso
        # cada bloque sólo migra si la tabla YA existe (PRAGMA devuelve filas).
        info = conn.execute(text("PRAGMA table_info(clientes_arca)")).fetchall()
        columnas = {row[1] for row in info}
        if info:
            if "usuario_id" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN usuario_id INTEGER"))
            if "regimen" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN regimen VARCHAR(20)"))
            if "deuda_detalle" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN deuda_detalle TEXT"))
            if "facturacion_12m" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN facturacion_12m NUMERIC(15,2)"))
            if "tope_categoria" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN tope_categoria NUMERIC(15,2)"))
            if "facturometro_actualizado" not in columnas:
                conn.execute(
                    text("ALTER TABLE clientes_arca ADD COLUMN facturometro_actualizado VARCHAR(20)")
                )
            if "edicion_json" not in columnas:
                conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN edicion_json TEXT"))

        # Moneda/cotización de comprobantes (Factura E y demás en moneda extranjera).
        info_c = conn.execute(text("PRAGMA table_info(comprobantes_emitidos)")).fetchall()
        cols_c = {row[1] for row in info_c}
        if info_c:
            if "moneda" not in cols_c:
                conn.execute(
                    text("ALTER TABLE comprobantes_emitidos ADD COLUMN moneda VARCHAR(8) DEFAULT 'ARS'")
                )
            if "cotizacion" not in cols_c:
                conn.execute(
                    text("ALTER TABLE comprobantes_emitidos ADD COLUMN cotizacion NUMERIC(15,6) DEFAULT 1")
                )
            if "imp_total_origen" not in cols_c:
                conn.execute(
                    text("ALTER TABLE comprobantes_emitidos ADD COLUMN imp_total_origen NUMERIC(15,2)")
                )

        # Configuración del contador (ventanas/umbrales/inflación) guardada en la cuenta.
        info_u = conn.execute(text("PRAGMA table_info(usuarios)")).fetchall()
        cols_u = {row[1] for row in info_u}
        if info_u and "config_json" not in cols_u:
            conn.execute(text("ALTER TABLE usuarios ADD COLUMN config_json TEXT"))
