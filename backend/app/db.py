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


# Emails que se marcan como admin del panel superadmin al iniciar (idempotente). Si una de estas
# cuentas todavía no existe, simplemente no pasa nada hasta que se registre y vuelva a arrancar.
ADMINS_SEMILLA = ("ulises25103@gmail.com", "diego@orbita.com")


def _migrar_usuarios(conn) -> None:
    """Agrega las columnas del panel admin a `usuarios` y marca los admins semilla.
    Portable SQLite + Postgres (las demás migraciones de abajo son SQLite-only)."""
    es_sqlite = settings.database_url.startswith("sqlite")
    if es_sqlite:
        info = conn.execute(text("PRAGMA table_info(usuarios)")).fetchall()
        if not info:  # la tabla aún no existe: create_all ya la creó con todas las columnas
            return
        cols = {row[1] for row in info}
    else:
        cols = {
            row[0]
            for row in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = 'usuarios'")
            )
        }
        if not cols:  # tabla recién creada por create_all: ya trae las columnas
            return

    nuevas = {
        "rol": "VARCHAR(20) DEFAULT 'contador'",
        "activo": "BOOLEAN DEFAULT TRUE" if not es_sqlite else "BOOLEAN DEFAULT 1",
        "ultimo_acceso": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        "ultimo_logout": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        "trial_fin": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        # Recuperación de contraseña: hash del token de reset + su expiración (NULL = sin reset pendiente).
        "reset_token_hash": "VARCHAR(64)",
        "reset_token_exp": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        # Confirmación de email: estado + hash del token de confirmación + su expiración.
        "email_confirmado": "BOOLEAN DEFAULT FALSE" if not es_sqlite else "BOOLEAN DEFAULT 0",
        "email_token_hash": "VARCHAR(64)",
        "email_token_exp": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
    }
    for nombre, tipo in nuevas.items():
        if nombre not in cols:
            conn.execute(text(f"ALTER TABLE usuarios ADD COLUMN {nombre} {tipo}"))

    # Backfill de filas previas (las nuevas columnas quedaron NULL en datos viejos) + seed de admins.
    conn.execute(text("UPDATE usuarios SET rol = 'contador' WHERE rol IS NULL"))
    conn.execute(
        text("UPDATE usuarios SET activo = TRUE WHERE activo IS NULL")
        if not es_sqlite
        else text("UPDATE usuarios SET activo = 1 WHERE activo IS NULL")
    )
    # Período de prueba: las cuentas previas a la feature (sin fin de trial) arrancan 30 días desde
    # HOY. Las nuevas lo setean en el registro. Idempotente (sólo toca las NULL).
    conn.execute(
        text("UPDATE usuarios SET trial_fin = NOW() + INTERVAL '30 days' WHERE trial_fin IS NULL")
        if not es_sqlite
        else text("UPDATE usuarios SET trial_fin = datetime('now', '+30 days') WHERE trial_fin IS NULL")
    )
    # Confirmación de email: las cuentas previas a la feature quedan sin confirmar (NULL → FALSE);
    # verán el banner y se confirman solas con el botón "reenviar" del front. No mandamos correos en
    # la migración. Los admins semilla se dan por confirmados (operan el sistema; su email puede no
    # ser una casilla real) en el loop de abajo.
    conn.execute(
        text("UPDATE usuarios SET email_confirmado = FALSE WHERE email_confirmado IS NULL")
        if not es_sqlite
        else text("UPDATE usuarios SET email_confirmado = 0 WHERE email_confirmado IS NULL")
    )
    for email in ADMINS_SEMILLA:
        conn.execute(
            text(
                "UPDATE usuarios SET rol = 'admin', email_confirmado = TRUE "
                "WHERE LOWER(email) = :email"
            )
            if not es_sqlite
            else text(
                "UPDATE usuarios SET rol = 'admin', email_confirmado = 1 "
                "WHERE LOWER(email) = :email"
            ),
            {"email": email.lower()},
        )


def _columnas(conn, tabla: str) -> set[str]:
    """Nombres de columna de `tabla` (vacío si no existe). Portable SQLite + Postgres."""
    if settings.database_url.startswith("sqlite"):
        info = conn.execute(text(f"PRAGMA table_info({tabla})")).fetchall()
        return {row[1] for row in info}
    return {
        row[0]
        for row in conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
            {"t": tabla},
        )
    }


def _migrar_alertas_enviadas(conn) -> None:
    """Agrega `severidad`/`activa` a `alertas_enviadas` (motor de alertas 'solo lo nuevo').
    Portable SQLite + Postgres. Las filas viejas (bitácora del cooldown anterior) se marcan
    activa=FALSE para que no supriman alertas vigentes: el motor las re-enviará una vez como nuevas."""
    es_sqlite = settings.database_url.startswith("sqlite")
    cols = _columnas(conn, "alertas_enviadas")
    if not cols:  # tabla recién creada por create_all: ya trae las columnas
        return
    if "severidad" not in cols:
        conn.execute(
            text("ALTER TABLE alertas_enviadas ADD COLUMN severidad VARCHAR(10) DEFAULT 'urgente'")
        )
    if "activa" not in cols:
        conn.execute(
            text(
                "ALTER TABLE alertas_enviadas ADD COLUMN activa BOOLEAN DEFAULT TRUE"
                if not es_sqlite
                else "ALTER TABLE alertas_enviadas ADD COLUMN activa BOOLEAN DEFAULT 1"
            )
        )
        # Backfill SÓLO al crear la columna (idempotente): las filas previas dejan de suprimir.
        conn.execute(
            text("UPDATE alertas_enviadas SET activa = FALSE")
            if not es_sqlite
            else text("UPDATE alertas_enviadas SET activa = 0")
        )


def asegurar_columnas() -> None:
    """Migración ligera (sin Alembic): agrega columnas nuevas a tablas ya existentes.
    create_all() crea tablas faltantes pero NO altera las existentes."""
    # Migraciones portables a SQLite y Postgres.
    with engine.begin() as conn:
        _migrar_usuarios(conn)
        _migrar_alertas_enviadas(conn)

    # El resto son migraciones de tablas que sólo existen viejas en el SQLite de desarrollo.
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
