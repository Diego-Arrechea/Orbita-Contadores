"""Motor de sincronización continua 24/7 (corre en su propio contenedor: `python -m app.worker`).

En vez de un batch diario a las 3 AM, mantiene un pool de N workers que sincronizan clientes sin
parar, eligiendo siempre a los más "vencidos" (cuya última extracción superó el intervalo objetivo).
El estado vive en Postgres (tabla `extracciones`), así que sobrevive reinicios sin cola externa.

Reglas clave:
- **Serialización por contador**: nunca corren dos clientes del MISMO contador a la vez (comparten
  la clave fiscal de ARCA; dos logins simultáneos serían sospechosos). Contadores distintos sí van
  en paralelo, hasta `sync_worker_concurrencia`.
- **Alertas**: un pase periódico consolida y manda WhatsApp por contador (cooldown de 7 días evita
  spam), respetando el horario silencioso.
- **Janitor**: limpia perfiles temporales de Chromium que quedaron de corridas que crashearon.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import queue
import signal
import threading
import time

from sqlalchemy import func, or_, select

from ..config import settings
from ..db import SessionLocal
from ..models import ClienteARCA, Extraccion, WorkerHeartbeat
from ..services.alertas import evaluar_y_notificar
from ..services.scheduler import _sincronizar_con_reintento
from ..services.sincronizacion import sincronizar_padron
from .janitor import limpiar_perfiles_viejos

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("orbita.worker")

# --- Estado compartido del pool ---
_cola: queue.Queue[tuple[str, str]] = queue.Queue()
_en_vuelo_cuits: set[str] = set()        # clientes encolados o sincronizándose ahora
_en_vuelo_contadores: set[str] = set()   # cuit_contador en vuelo (serializa por clave fiscal)
_lock = threading.Lock()
_stop = threading.Event()


def _clientes_vencidos(db, limite: dt.datetime, limite_fallidos: dt.datetime):
    """Clientes a re-sincronizar: nunca corridos, o cuya última extracción superó `limite`, o cuya
    última extracción FALLÓ y superó `limite_fallidos` (reintento más rápido para fallos transitorios).
    Más vencidos primero (los que nunca corrieron, primero de todo)."""
    # Última extracción por cliente vía max(id): id es monótono → la fila más reciente, sin
    # ambigüedad por fecha duplicada. Portable SQLite + Postgres.
    ult_id = (
        select(Extraccion.cuit, func.max(Extraccion.id).label("mid"))
        .group_by(Extraccion.cuit)
        .subquery()
    )
    ult = (
        select(Extraccion.cuit, Extraccion.fecha.label("fecha"), Extraccion.resultado.label("resultado"))
        .join(ult_id, Extraccion.id == ult_id.c.mid)
        .subquery()
    )
    # coalesce a una fecha muy vieja: NULL (nunca sincronizado) ordena primero, de forma portable.
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    q = (
        select(ClienteARCA.cuit, ClienteARCA.cuit_contador)
        .outerjoin(ult, ult.c.cuit == ClienteARCA.cuit)
        .where(
            or_(
                ult.c.fecha.is_(None),                                            # nunca sincronizado
                ult.c.fecha < limite,                                             # vencido normal
                (ult.c.resultado == "fallida") & (ult.c.fecha < limite_fallidos),  # reintento de fallido
            )
        )
        .order_by(func.coalesce(ult.c.fecha, epoch).asc())
    )
    return db.execute(q).all()


def _despachar() -> int:
    """Encola los clientes vencidos que no estén en vuelo y cuyo contador esté libre. Devuelve
    cuántos encoló en esta pasada."""
    ahora = dt.datetime.now(dt.timezone.utc)
    limite = ahora - dt.timedelta(hours=settings.sync_intervalo_horas)
    limite_fallidos = ahora - dt.timedelta(minutes=settings.sync_reintento_fallidos_min)
    db = SessionLocal()
    try:
        vencidos = _clientes_vencidos(db, limite, limite_fallidos)
    finally:
        db.close()

    encolados = 0
    with _lock:
        for cuit, cuit_contador in vencidos:
            if cuit in _en_vuelo_cuits:
                continue
            if cuit_contador in _en_vuelo_contadores:
                continue  # ese contador ya tiene un cliente en vuelo → serializa
            _en_vuelo_cuits.add(cuit)
            _en_vuelo_contadores.add(cuit_contador)
            _cola.put((cuit, cuit_contador))
            encolados += 1
    return encolados


def _worker(idx: int) -> None:
    """Hilo worker: saca un cliente de la cola, lo sincroniza (comprobantes + padrón) y libera."""
    while not _stop.is_set():
        try:
            cuit, cuit_contador = _cola.get(timeout=2)
        except queue.Empty:
            continue
        db = SessionLocal()
        try:
            n = _sincronizar_con_reintento(db, cuit)
            try:
                sincronizar_padron(db, cuit)  # best-effort: no aplica o falló, comprobantes ya están
            except Exception:  # noqa: BLE001
                pass
            logger.info("[w%d] %s OK -> %s comprobantes nuevos", idx, cuit, n)
        except Exception as e:  # noqa: BLE001 — la falla ya quedó en `extracciones` con su motivo
            logger.warning("[w%d] %s FALLÓ: %s", idx, cuit, str(e)[:160])
        finally:
            db.close()
            with _lock:
                _en_vuelo_cuits.discard(cuit)
                _en_vuelo_contadores.discard(cuit_contador)
            _cola.task_done()


def _en_horario_silencioso(ahora: dt.datetime) -> bool:
    """¿La hora actual (AR; el contenedor corre en TZ Argentina) cae en la franja silenciosa?"""
    ini, fin = settings.sync_quiet_inicio, settings.sync_quiet_fin
    if ini == fin:
        return False
    h = ahora.hour
    return ini <= h < fin if ini < fin else (h >= ini or h < fin)  # soporta cruce de medianoche


_ultimo_alertas = 0.0


def _quizas_pasar_alertas() -> None:
    """Cada `sync_alertas_cada_min` minutos (y fuera del horario silencioso), evalúa alertas y manda
    WhatsApp consolidado por contador. El cooldown de 7 días evita reenviar la misma alerta."""
    global _ultimo_alertas
    if not settings.sync_alertas_enabled:
        return  # envío automático apagado: el motor sincroniza pero no manda WhatsApp todavía
    if time.monotonic() - _ultimo_alertas < settings.sync_alertas_cada_min * 60:
        return
    if _en_horario_silencioso(dt.datetime.now()):
        return
    _ultimo_alertas = time.monotonic()
    db = SessionLocal()
    try:
        res = evaluar_y_notificar(db)
        if res:
            logger.info("alertas: %s", res)
    except Exception:  # noqa: BLE001
        logger.warning("evaluar_y_notificar falló", exc_info=True)
    finally:
        db.close()


def _latir() -> None:
    """Pisa la fila de heartbeat (id=1) con el estado actual: cuándo, qué hay en vuelo y la config.
    El panel admin lo lee para mostrar si el motor está vivo y qué sincroniza ahora."""
    db = SessionLocal()
    try:
        with _lock:
            en_vuelo = json.dumps(sorted(_en_vuelo_cuits))
        ahora = dt.datetime.now(dt.timezone.utc)
        hb = db.get(WorkerHeartbeat, 1)
        if hb is None:
            hb = WorkerHeartbeat(id=1)
            db.add(hb)
        hb.actualizado_en = ahora
        hb.en_vuelo = en_vuelo
        hb.concurrencia = settings.sync_worker_concurrencia
        hb.intervalo_horas = settings.sync_intervalo_horas
        db.commit()
    except Exception:  # noqa: BLE001
        logger.warning("latido falló", exc_info=True)
    finally:
        db.close()


_ultimo_janitor = 0.0


def _quizas_janitor() -> None:
    global _ultimo_janitor
    if time.monotonic() - _ultimo_janitor < 3600:  # 1 vez por hora
        return
    _ultimo_janitor = time.monotonic()
    try:
        borrados = limpiar_perfiles_viejos()
        if borrados:
            logger.info("janitor: %d perfiles temporales viejos borrados", borrados)
    except Exception:  # noqa: BLE001
        logger.warning("janitor falló", exc_info=True)


def main() -> None:
    # Asegura que las tablas existan (idempotente) por si el worker arranca antes que el backend:
    # importar WorkerHeartbeat ya registró el modelo en Base.metadata.
    from ..db import Base, engine

    Base.metadata.create_all(bind=engine)

    n = max(1, settings.sync_worker_concurrencia)

    def _parar(*_):  # SIGTERM/SIGINT → apagado ordenado (docker stop)
        logger.info("señal de apagado recibida, terminando…")
        _stop.set()

    signal.signal(signal.SIGTERM, _parar)
    signal.signal(signal.SIGINT, _parar)

    for i in range(n):
        threading.Thread(target=_worker, args=(i,), daemon=True).start()
    logger.info(
        "motor de sync arrancado: %d workers, refresco cada %dh, poll %ds, silencio %02d→%02d (AR)",
        n,
        settings.sync_intervalo_horas,
        settings.sync_poll_segundos,
        settings.sync_quiet_inicio,
        settings.sync_quiet_fin,
    )

    while not _stop.is_set():
        try:
            encolados = _despachar()
            if encolados:
                logger.info("despachados %d cliente(s) vencido(s)", encolados)
        except Exception:  # noqa: BLE001
            logger.warning("despachar falló", exc_info=True)
        _latir()  # registra el latido (vivo + en vuelo) para el panel admin
        _quizas_pasar_alertas()
        _quizas_janitor()
        _stop.wait(settings.sync_poll_segundos)

    logger.info("motor de sync detenido")
