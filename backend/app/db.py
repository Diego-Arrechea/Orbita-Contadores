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
        # LEGACY: la feature de prueba gratis se retiró. Mantenemos la columna para no dropearla en
        # prod (queda NULL); ya no se backfillea ni se usa.
        "trial_fin": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        # Recuperación de contraseña: hash del token de reset + su expiración (NULL = sin reset pendiente).
        "reset_token_hash": "VARCHAR(64)",
        "reset_token_exp": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        # Confirmación de email: estado + hash del token de confirmación + su expiración.
        "email_confirmado": "BOOLEAN DEFAULT FALSE" if not es_sqlite else "BOOLEAN DEFAULT 0",
        "email_token_hash": "VARCHAR(64)",
        "email_token_exp": "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE",
        # Aviso de lanzamiento de alertas: SIN default a propósito (existing rows → NULL → se siembran
        # en 2 abajo; los nuevos usan el default 0 del modelo). Cuántos ingresos más mostrar el modal.
        "aviso_alertas_pendiente": "INTEGER",
        # Equipo del estudio ("Gestión de usuarios"): titular_id ≠ NULL marca la cuenta como EMPLEADO
        # de ese titular; permisos_json guarda sus permisos ({clave: bool}, NULL = todos habilitados).
        "titular_id": "INTEGER REFERENCES usuarios(id)",
        "permisos_json": "TEXT",
    }
    for nombre, tipo in nuevas.items():
        if nombre not in cols:
            conn.execute(text(f"ALTER TABLE usuarios ADD COLUMN {nombre} {tipo}"))

    # `cuit` pasó a ser nullable (las cuentas de empleado no cargan CUIT). En Postgres alcanza un
    # ALTER idempotente; en SQLite no se puede soltar el NOT NULL con ALTER → _cuit_nullable_sqlite
    # reconstruye la tabla (sólo la primera vez; dev-only).
    if es_sqlite:
        _cuit_nullable_sqlite(conn)
    else:
        conn.execute(text("ALTER TABLE usuarios ALTER COLUMN cuit DROP NOT NULL"))

    # Backfill de filas previas (las nuevas columnas quedaron NULL en datos viejos) + seed de admins.
    conn.execute(text("UPDATE usuarios SET rol = 'contador' WHERE rol IS NULL"))
    conn.execute(
        text("UPDATE usuarios SET activo = TRUE WHERE activo IS NULL")
        if not es_sqlite
        else text("UPDATE usuarios SET activo = 1 WHERE activo IS NULL")
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
    # Aviso de lanzamiento de alertas: los contadores que YA existían lo ven 2 ingresos (idempotente:
    # sólo toca los NULL recién creados por el ALTER; los nuevos registros arrancan en 0 por el modelo).
    conn.execute(text("UPDATE usuarios SET aviso_alertas_pendiente = 2 WHERE aviso_alertas_pendiente IS NULL"))
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


def _cuit_nullable_sqlite(conn) -> None:
    """SQLite (dev) no soporta soltar un NOT NULL por ALTER: si `usuarios.cuit` sigue NOT NULL (DB
    creada antes del equipo de estudio), reconstruye la tabla desde el modelo actual copiando los
    datos. Idempotente: si el flag ya está en 0, no hace nada."""
    info = conn.execute(text("PRAGMA table_info(usuarios)")).fetchall()
    col = next((row for row in info if row[1] == "cuit"), None)
    if col is None or not col[3]:  # row[3] = flag notnull; 0 → ya es nullable
        return
    # Import perezoso: models importa Base de este módulo (a nivel función no hay ciclo).
    from sqlalchemy.schema import CreateIndex, CreateTable

    from . import models

    tabla = models.Usuario.__table__
    columnas_modelo = {c.name for c in tabla.columns}
    comunes = ", ".join(row[1] for row in info if row[1] in columnas_modelo)
    # legacy_alter_table=ON: que el RENAME no re-apunte a `usuarios_old` las FKs de OTRAS tablas
    # (clientes_arca.usuario_id, etc.), que deben seguir referenciando a `usuarios`.
    conn.execute(text("PRAGMA legacy_alter_table=ON"))
    conn.execute(text("ALTER TABLE usuarios RENAME TO usuarios_old"))
    conn.execute(text(str(CreateTable(tabla).compile(engine))))
    conn.execute(text(f"INSERT INTO usuarios ({comunes}) SELECT {comunes} FROM usuarios_old"))
    conn.execute(text("DROP TABLE usuarios_old"))  # sus índices caen con ella
    conn.execute(text("PRAGMA legacy_alter_table=OFF"))
    for indice in tabla.indexes:  # re-crear los índices únicos (email/cuit) del modelo
        conn.execute(text(str(CreateIndex(indice).compile(engine))))


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
    if "valor" not in cols:  # valor de la métrica al avisar (para el re-aviso por subida)
        conn.execute(text("ALTER TABLE alertas_enviadas ADD COLUMN valor NUMERIC(15,4)"))


def _migrar_clientes_arca(conn) -> None:
    """Agrega `alertas_baseline_en` a `clientes_arca` (línea de base de alertas). Portable SQLite +
    Postgres (el resto de migraciones de clientes_arca abajo son SQLite-only, para la DB de dev)."""
    es_sqlite = settings.database_url.startswith("sqlite")
    cols = _columnas(conn, "clientes_arca")
    if not cols:
        return
    if "alertas_baseline_en" not in cols:
        tipo = "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE"
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN alertas_baseline_en {tipo}"))
    # Línea de base del Domicilio Fiscal Electrónico (comunicaciones): mismo criterio que arriba.
    if "dfe_baseline_en" not in cols:
        tipo = "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE"
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN dfe_baseline_en {tipo}"))
    # Certificado de facturación electrónica del cliente (cifrado). BLOB en SQLite, BYTEA en Postgres.
    blob = "BLOB" if es_sqlite else "BYTEA"
    ts = "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE"
    if "cert_cifrado" not in cols:
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN cert_cifrado {blob}"))
    if "key_cifrado" not in cols:
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN key_cifrado {blob}"))
    if "cert_actualizado_en" not in cols:
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN cert_actualizado_en {ts}"))
    # Snapshot de datos fiscales del emisor (domicilio/localidad/provincia/CP) para imprimir el
    # comprobante emitido. JSON serializado. Portable: TEXT anda igual en SQLite y Postgres.
    if "emisor_fiscal_json" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN emisor_fiscal_json TEXT"))
    # ¿Tiene relación de dependencia? (valor auto-detectado; el override manual va en edicion_json).
    # BOOLEAN anda igual en SQLite y Postgres.
    if "relacion_dependencia" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN relacion_dependencia BOOLEAN"))
    # ARCA forzó cambio de Clave Fiscal: bloquea la sync hasta que el cliente la cambie. Se muestra en
    # la lista de clientes. DEFAULT FALSE anda igual en SQLite (0/FALSE) y Postgres.
    if "clave_requiere_cambio" not in cols:
        conn.execute(
            text("ALTER TABLE clientes_arca ADD COLUMN clave_requiere_cambio BOOLEAN DEFAULT FALSE")
        )
    # La Clave Fiscal del cliente dejó de servir (ARCA la rechaza o el acceso falla repetido): el
    # contador la corrige desde la ficha. Se muestra en la lista. DEFAULT FALSE anda en SQLite y Postgres.
    if "clave_invalida" not in cols:
        conn.execute(
            text("ALTER TABLE clientes_arca ADD COLUMN clave_invalida BOOLEAN DEFAULT FALSE")
        )
    # ¿Factura por Liquidaciones Electrónicas del sector primario (agro)? Habilita la sync semanal de
    # esas liquidaciones y su apartado. DEFAULT FALSE anda igual en SQLite (0/FALSE) y Postgres.
    if "factura_agro" not in cols:
        conn.execute(
            text("ALTER TABLE clientes_arca ADD COLUMN factura_agro BOOLEAN DEFAULT FALSE")
        )
    # Cuándo se chequeó por última vez si el cliente tiene liquidaciones del agro (NULL = nunca →
    # el motor lo detecta en su próxima sync, una sola vez). TIMESTAMP portable SQLite + Postgres.
    if "agro_chequeado_en" not in cols:
        tipo = "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE"
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN agro_chequeado_en {tipo}"))
    # Remuneración en relación de dependencia ("Aportes en Línea"), JSON serializado. TEXT portable.
    if "remuneraciones_json" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN remuneraciones_json TEXT"))
    # Cuándo se chequeó por última vez "Aportes en Línea" (NULL = nunca). TIMESTAMP portable.
    if "aportes_chequeado_en" not in cols:
        tipo = "TIMESTAMP" if es_sqlite else "TIMESTAMP WITH TIME ZONE"
        conn.execute(text(f"ALTER TABLE clientes_arca ADD COLUMN aportes_chequeado_en {tipo}"))
    # Meses seguidos de monotributo que adeuda hoy (Consulta de Saldos de la CCMA). INTEGER anda igual
    # en SQLite y Postgres; NULL = sin dato (no monotributista o sync sin CCMA).
    if "meses_adeudados" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN meses_adeudados INTEGER"))
    # Ventana de recategorización REAL del padrón (fechas oficiales de ARCA, ISO). VARCHAR/BOOLEAN
    # andan igual en SQLite y Postgres; NULL = sin dato (no monotributista o sync sin esa consulta).
    if "recat_ventana_desde" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN recat_ventana_desde VARCHAR(20)"))
    if "recat_ventana_hasta" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN recat_ventana_hasta VARCHAR(20)"))
    if "recat_mostrar_alerta" not in cols:
        conn.execute(text("ALTER TABLE clientes_arca ADD COLUMN recat_mostrar_alerta BOOLEAN"))
    # ¿El contador tiene activo el monitoreo del cliente? En False el motor de sync lo saltea y en la
    # lista aparece como "Desactivado". DEFAULT TRUE → los clientes ya existentes quedan activos.
    if "activo" not in cols:
        conn.execute(
            text("ALTER TABLE clientes_arca ADD COLUMN activo BOOLEAN DEFAULT TRUE")
        )


def _migrar_comprobantes_emitidos(conn) -> None:
    """Agrega `cae_vto` a `comprobantes_emitidos` (vto del CAE de los comprobantes emitidos desde la
    app, para imprimirlos). Portable SQLite + Postgres."""
    cols = _columnas(conn, "comprobantes_emitidos")
    if not cols:
        return
    if "cae_vto" not in cols:
        conn.execute(
            text("ALTER TABLE comprobantes_emitidos ADD COLUMN cae_vto VARCHAR(10) DEFAULT ''")
        )
    if "condicion_iva_receptor" not in cols:
        conn.execute(
            text("ALTER TABLE comprobantes_emitidos ADD COLUMN condicion_iva_receptor INTEGER")
        )


def asegurar_columnas() -> None:
    """Migración ligera (sin Alembic): agrega columnas nuevas a tablas ya existentes.
    create_all() crea tablas faltantes pero NO altera las existentes."""
    # Migraciones portables a SQLite y Postgres.
    with engine.begin() as conn:
        _migrar_usuarios(conn)
        _migrar_alertas_enviadas(conn)
        _migrar_clientes_arca(conn)
        _migrar_comprobantes_emitidos(conn)

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
