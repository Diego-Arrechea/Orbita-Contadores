"""
Sincronización de comprobantes EMITIDOS (ventas) y RECIBIDOS (compras) desde 'Mis Comprobantes'
(scraping con la clave del contador) y cache en la DB.

INCREMENTAL por dirección: la primera vez trae el histórico (ventanas de 365 días); las
siguientes, sólo desde el último comprobante de esa dirección (con un margen de solapamiento).
El upsert (índice único cuit+direccion+pv+tipo+nro) deduplica el solapamiento.
"""
from __future__ import annotations

import datetime as dt
import json
import time

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..arca.afip import ClaveInvalidaError, ClaveVencidaError, LoginSinJWTError
from ..config import settings
from ..crypto import descifrar
from ..scraping import miscomprobantes  # sólo helpers motor-agnósticos: ventanas() + PLAN_*


def _parse_fecha(yyyymmdd: str) -> dt.date:
    return dt.date(int(yyyymmdd[0:4]), int(yyyymmdd[4:6]), int(yyyymmdd[6:8]))


def _primer_dia_mes_hace(ref: dt.date, meses: int) -> dt.date:
    """Primer día del mes que está `meses` meses antes de `ref`. Ej.: ref=2026-06-04, meses=14 ->
    2025-04-01."""
    total = ref.year * 12 + (ref.month - 1) - meses
    return dt.date(total // 12, total % 12 + 1, 1)


def _ventanas(db: Session, cuit: str, direccion: str) -> list[tuple[str, str]]:
    """Ventanas (dd/mm/aaaa) a consultar para una dirección, hasta ayer.

    Primera vez: histórico de N años. Incremental: re-barre SIEMPRE los últimos
    `sync_meses_revision` meses anclados a HOY (no a la última fecha guardada). El anclaje a la
    última fecha + margen sólo capturaba comprobantes nuevos con fecha reciente, y perdía para
    siempre los que ARCA carga tarde con fecha de emisión vieja (o las correcciones de monto en
    meses pasados) — la causa de que el 'facturado 12m' calculado quedara por debajo del de ARCA. El
    upsert deduplica/actualiza el solapamiento; el histórico previo a la ventana de revisión ya
    quedó cacheado en la primera sync y no se vuelve a tocar."""
    ultima = db.scalar(
        select(func.max(models.ComprobanteEmitido.fecha)).where(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.direccion == direccion,
        )
    )
    hoy = dt.date.today()
    ayer = hoy - dt.timedelta(days=1)
    if ultima:
        revision = _primer_dia_mes_hace(hoy, settings.sync_meses_revision)
        margen = ultima - dt.timedelta(days=settings.sync_margen_dias)
        # El más viejo de los dos: la ventana de revisión (caso normal) o, si el cliente no se
        # sincroniza hace más de N meses, desde su última fecha − margen (para no dejar hueco).
        desde = min(revision, margen)
    else:
        desde = dt.date(hoy.year - settings.sync_anios_historico, 1, 1)
    if desde > ayer:
        desde = ayer
    return miscomprobantes.ventanas(desde, ayer)


def _upsert(db: Session, cuit: str, direccion: str, crudos: list[dict]) -> tuple[int, int]:
    """Inserta/actualiza los comprobantes. Devuelve (procesados, nuevos): `procesados` es todo lo
    que tocó (la ventana incremental re-barre meses ya conocidos), `nuevos` son sólo los que no
    existían (inserts) — los que realmente se trajeron por primera vez en esta corrida."""
    ahora = dt.datetime.now(dt.timezone.utc)
    procesados = 0
    nuevos = 0
    for c in crudos:
        if not c.get("fecha") or not c.get("numero"):
            continue
        # Consolidación a pesos EN EL BORDE: 'imp_total' del scraper viene en la moneda de origen
        # (USD para exportación); lo pasamos a pesos con la cotización del propio comprobante. Para
        # pesos, moneda='ARS' y cotizacion=1, así que imp_total no cambia. El .get() tolera fuentes
        # que no traen moneda (p.ej. WSFEv1).
        cot = float(c.get("cotizacion", 1.0) or 1.0)
        origen = float(c["imp_total"])
        pesos = origen * cot
        moneda = c.get("moneda", "ARS")
        existe = db.scalar(
            select(models.ComprobanteEmitido).where(
                models.ComprobanteEmitido.cuit == cuit,
                models.ComprobanteEmitido.direccion == direccion,
                models.ComprobanteEmitido.punto_venta == c["punto_venta"],
                models.ComprobanteEmitido.cbte_tipo == c["cbte_tipo"],
                models.ComprobanteEmitido.numero == c["numero"],
            )
        )
        if existe:
            existe.fecha = _parse_fecha(c["fecha"])
            existe.imp_total = pesos
            existe.imp_total_origen = origen
            existe.moneda = moneda
            existe.cotizacion = cot
            existe.doc_nro = c["doc_nro"]
            existe.contraparte_nombre = c.get("contraparte_nombre", "")
            existe.cae = c["cae"]
            existe.sincronizado_en = ahora
        else:
            db.add(
                models.ComprobanteEmitido(
                    cuit=cuit,
                    direccion=direccion,
                    cbte_tipo=c["cbte_tipo"],
                    punto_venta=c["punto_venta"],
                    numero=c["numero"],
                    fecha=_parse_fecha(c["fecha"]),
                    imp_total=pesos,
                    imp_total_origen=origen,
                    moneda=moneda,
                    cotizacion=cot,
                    doc_nro=c["doc_nro"],
                    contraparte_nombre=c.get("contraparte_nombre", ""),
                    cae=c["cae"],
                )
            )
            nuevos += 1
        procesados += 1
    return procesados, nuevos


def _intentar_lock_cuit(db: Session, cuit: str) -> bool:
    """Toma un lock de sincronización por CUIT COMPARTIDO ENTRE PROCESOS (API + motor 24/7) vía
    advisory locks de Postgres. Devuelve True si lo tomó (nadie más está sincronizando este CUIT en
    todo el sistema) o False si ya hay una corrida en curso en otro proceso/hilo.

    Por qué a nivel DB y no en memoria: el motor continuo corre en OTRO contenedor que la API, así
    que sus sets `_en_vuelo_cuits` no se ven entre sí. Si ambos caen sobre el mismo cliente a la vez,
    los dos bajan los mismos comprobantes y el segundo `commit` choca con el índice único
    (uq_comprobante) → UniqueViolation. El advisory lock es el único candado que ven los dos procesos.

    Es a nivel TRANSACCIÓN (`pg_try_advisory_xact_lock`): se libera solo al commit/rollback de la
    sync, sin soltarlo a mano. En SQLite (dev) no hay advisory locks ni motor concurrente → True."""
    if db.get_bind().dialect.name != "postgresql":
        return True
    # El CUIT es numérico de 11 dígitos → entra cómodo en el bigint del advisory lock (clave estable).
    return bool(db.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": int(cuit)}))


def _ms(inicio: float) -> int:
    return int((time.monotonic() - inicio) * 1000)


def _registrar_extraccion(
    db: Session,
    cuit: str,
    resultado: str,
    comprobantes: int,
    duracion_ms: int,
    motivo: str | None = None,
) -> None:
    """Agrega una fila a la bitácora de sincronizaciones (tabla extracciones)."""
    db.add(
        models.Extraccion(
            cuit=cuit,
            resultado=resultado,
            comprobantes=comprobantes,
            duracion_ms=duracion_ms,
            motivo=motivo,
        )
    )
    db.commit()


# Motivo exacto que registra la bitácora cuando el login no devolvió el JWT (ver arca/afip.py). Se usa
# para detectar el patrón "el acceso falla repetido" sin depender de la clase de la excepción.
_MOTIVO_SIN_JWT = "No se encontró el JWT tras enviar la clave."


def _login_falla_repetido(db: Session, cuit: str, minimo: int = 2) -> bool:
    """True si las últimas `minimo` extracciones del cliente fallaron TODAS por 'no se pudo entrar'
    (sin JWT). Sirve para NO marcar la clave a revisar por un fallo puntual/transitorio de ARCA: recién
    lo damos por problema real de la clave cuando se repite. Se llama DESPUÉS de registrar el fallo
    actual, así la corrida en curso ya cuenta."""
    motivos = db.scalars(
        select(models.Extraccion.motivo)
        .where(models.Extraccion.cuit == cuit)
        .order_by(models.Extraccion.fecha.desc(), models.Extraccion.id.desc())
        .limit(minimo)
    ).all()
    return len(motivos) >= minimo and all(m and _MOTIVO_SIN_JWT in m for m in motivos)


def ultima_extraccion(db: Session, cuit: str) -> "models.Extraccion | None":
    """La extracción más reciente de un cliente (para 'última sincronización')."""
    return db.scalar(
        select(models.Extraccion)
        .where(models.Extraccion.cuit == cuit)
        .order_by(models.Extraccion.fecha.desc(), models.Extraccion.id.desc())
        .limit(1)
    )


def sincronizar(db: Session, cuit: str, headless: bool | None = None, on_progress=None) -> int:
    """Trae emitidos + recibidos del CUIT desde Mis Comprobantes (incremental) y hace upsert.
    Devuelve cuántos comprobantes NUEVOS se trajeron en esta corrida (inserts), que es también lo
    que registra la bitácora de extracciones en `comprobantes`. OJO: la ventana incremental re-barre
    meses ya conocidos, pero esos no son novedad — sólo contamos/reportamos los que NO existían, que
    es lo que el panel debe mostrar ('cuántos trajo', no 'cuántos revisó')."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    # Una sola sincronización por CUIT en simultáneo EN TODO EL SISTEMA. Si otra corrida (el motor
    # 24/7, un sync manual, "sincronizar todos"…) ya está sobre este cliente, nos vamos sin hacer
    # nada: scrapear de nuevo bajaría los mismos comprobantes y el commit chocaría con uq_comprobante.
    # La corrida en curso ya trae los datos y registra su propia extracción. Devolvemos 0 nuevos (esta
    # corrida no aportó) y NO registramos una extracción (no es una falla ni una corrida real).
    if not _intentar_lock_cuit(db, cuit):
        return 0

    plan = [
        {**miscomprobantes.PLAN_EMITIDOS, "rangos": _ventanas(db, cuit, "emitido")},
        {**miscomprobantes.PLAN_RECIBIDOS, "rangos": _ventanas(db, cuit, "recibido")},
    ]
    inicio = time.monotonic()
    try:
        nombre, datos = motor.descargar(
            credencial.cuit, clave, cuit, plan, headless=headless, on_progress=on_progress
        )
        if nombre:  # nombre real del contribuyente desde el navbar de Mis Comprobantes
            cliente.nombre = nombre
        # El login funcionó → si el cliente estaba marcado por un problema de clave (cambio forzado por
        # AFIP o clave inválida), ya se resolvió: apagamos los avisos.
        if cliente.clave_requiere_cambio:
            cliente.clave_requiere_cambio = False
        if cliente.clave_invalida:
            cliente.clave_invalida = False
        nuevos = 0
        for direccion, crudos in datos.items():
            _, nv = _upsert(db, cuit, direccion, crudos)
            nuevos += nv
        db.commit()
    except ClaveVencidaError as e:
        # ARCA fuerza el cambio de Clave Fiscal: no es un fallo transitorio ni lo arreglamos nosotros.
        # Marcamos el cliente para avisarle al contador y NO reintentamos en vano (el circuit breaker
        # del motor igual lo saca del reintento rápido tras unos fallos).
        db.rollback()
        cliente.clave_requiere_cambio = True
        db.commit()
        _registrar_extraccion(db, cuit, "fallida", 0, _ms(inicio), str(e)[:300])
        raise
    except ClaveInvalidaError as e:
        # ARCA rechazó la clave guardada: no es transitorio ni lo arreglamos nosotros. Marcamos el
        # cliente para que el contador cargue la clave correcta desde la ficha; una sync exitosa apaga
        # el aviso solo.
        db.rollback()
        cliente.clave_invalida = True
        db.commit()
        _registrar_extraccion(db, cuit, "fallida", 0, _ms(inicio), str(e)[:300])
        raise
    except LoginSinJWTError as e:
        # El login no devolvió el JWT: puede ser un hipo puntual de ARCA (WAF/captcha/pantalla rara).
        # Registramos el fallo y SÓLO marcamos la clave a revisar si viene fallando así 2 veces seguidas
        # (evita marcar clientes sanos por una caída momentánea).
        db.rollback()
        _registrar_extraccion(db, cuit, "fallida", 0, _ms(inicio), str(e)[:300])
        if _login_falla_repetido(db, cuit):
            cliente.clave_invalida = True
            db.commit()
        raise
    except Exception as e:  # noqa: BLE001 — registra la extracción fallida y re-lanza
        db.rollback()
        _registrar_extraccion(db, cuit, "fallida", 0, _ms(inicio), str(e)[:300])
        raise
    _registrar_extraccion(db, cuit, "exitosa", nuevos, _ms(inicio))
    return nuevos


def sincronizar_padron(db: Session, cuit: str, headless: bool | None = None) -> dict:
    """Trae del portal Monotributo la categoría real, actividad, recategorización y facturómetro, y
    los guarda en el cliente. Funciona para el titular y para REPRESENTADOS (datos_monotributo fija
    'actuando en representación' y verifica el CUIT con un guard anti-cruce). Devuelve los datos o {}."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()
    # Trae la categoría/datos del padrón del CUIT objetivo. Si es representado (≠ credencial),
    # datos_monotributo fija "actuando en representación" y verifica el CUIT (guard anti-cruce):
    # devuelve {} si la representación no tomó, así nunca se le atribuye la categoría del contador.
    datos = motor.datos_monotributo(contador.cuit, clave, cuit_objetivo=cuit, headless=headless)
    # Régimen AUTORITATIVO del padrón (fuente oficial): si el portal de Monotributo abrió, es
    # monotributista; si no abrió, ARCA confirma que NO lo es. Sólo lo pisamos con una señal real
    # (no con None) para no borrar un valor previo si el padrón falló a medias.
    if datos.get("es_monotributista") is True or datos.get("categoria"):
        cliente.regimen = "monotributo"
    elif datos.get("es_monotributista") is False:
        cliente.regimen = "no_monotributo"
    if datos.get("categoria"):
        cliente.categoria = datos["categoria"]
        cliente.actividad = datos.get("actividad")
        cliente.prox_recategorizacion = datos.get("prox_recategorizacion")
    # Estado de cuota (CCMA) + próximo vencimiento (portal): guarda los que vinieron.
    for campo in (
        "cuota_estado",
        "cuota_deuda",
        "cuota_saldo_favor",
        "prox_venc_fecha",
        "prox_venc_importe",
        "debito_automatico",
        "facturacion_12m",
        "tope_categoria",
        "facturometro_actualizado",
    ):
        if datos.get(campo) is not None:
            setattr(cliente, campo, datos[campo])
    # Detalle de deuda de la CCMA (lo trae estado_cuota dentro de datos_monotributo): JSON serializado.
    if isinstance(datos.get("deuda_detalle"), dict):
        cliente.deuda_detalle = json.dumps(datos["deuda_detalle"], ensure_ascii=False)
    # Snapshot del domicilio fiscal del emisor (para imprimir comprobantes). Sólo se pisa si vino
    # con domicilio: motor_http omite la clave si el portal no lo trae, así no borramos uno bueno.
    if isinstance(datos.get("emisor_fiscal"), dict):
        cliente.emisor_fiscal_json = json.dumps(datos["emisor_fiscal"], ensure_ascii=False)
    if datos:
        db.commit()
    return datos


def sincronizar_todo(db: Session, cuit: str, headless: bool | None = None) -> int:
    """Sincroniza TODO lo scrapeable del cliente: comprobantes (Mis Comprobantes) + datos del padrón
    de Monotributo (categoría, actividad, recategorización, estado de cuota, vencimiento, débito,
    saldo a favor). El padrón es best-effort —sólo aplica al titular monotributista— y NO frena la
    sincronización de comprobantes si falla. Devuelve cuántos comprobantes procesó."""
    n = sincronizar(db, cuit, headless=headless)
    try:
        sincronizar_padron(db, cuit, headless=headless)
    except Exception:  # noqa: BLE001 — el padrón no aplica o falló; los comprobantes ya se trajeron
        pass
    # Comunicaciones del Domicilio Fiscal Electrónico (best-effort): reusa la sesión ya logueada del
    # cliente. No frena la sync si falla (ídem padrón).
    try:
        from . import comunicaciones

        comunicaciones.sincronizar_comunicaciones(db, cuit)
    except Exception:  # noqa: BLE001
        pass
    return n


def sincronizar_deuda(db: Session, cuit: str, headless: bool | None = None) -> dict:
    """Trae el detalle de deuda por el camino DIRECTO de la CCMA (Estado de cuenta → elegir CUIT →
    cálculo de deuda). Sirve para monotributistas, autónomos y representados. Guarda el detalle +
    los campos de cuota en el cliente. Devuelve el resumen ({} si no se pudo)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()
    res = motor.consultar_deuda(credencial.cuit, clave, cuit_objetivo=cuit, headless=headless)
    if isinstance(res.get("deuda_detalle"), dict):
        cliente.deuda_detalle = json.dumps(res["deuda_detalle"], ensure_ascii=False)
        for campo in ("cuota_estado", "cuota_deuda", "cuota_saldo_favor"):
            if res.get(campo) is not None:
                setattr(cliente, campo, res[campo])
        db.commit()
    elif res.get("no_aplica"):
        # "No aplica" (el cliente no tiene cuenta corriente): se PERSISTE el veredicto para no volver
        # a preguntar en cada recarga. Se guarda un marcador en deuda_detalle ({no_aplica, motivo}),
        # que también pisa cualquier detalle viejo (incl. uno mal atribuido). Los campos de cuota se
        # limpian porque no corresponden a un no-monotributista/no-autónomo.
        cliente.deuda_detalle = json.dumps(
            {"no_aplica": True, "motivo": res.get("motivo")}, ensure_ascii=False
        )
        cliente.cuota_estado = None
        cliente.cuota_deuda = None
        cliente.cuota_saldo_favor = None
        db.commit()
    return res
