"""Sincronización automática diaria de todos los clientes (APScheduler in-process).

El scheduler corre dentro del proceso de uvicorn: el job diario se dispara mientras el
backend esté vivo. La misma función `sincronizar_todos` la usa el endpoint manual
POST /api/sincronizar-todos (útil para probar o para un cron externo).
"""
from __future__ import annotations

import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from .. import models
from ..db import SessionLocal
from .alertas import evaluar_y_notificar
from .sincronizacion import sincronizar

logger = logging.getLogger("orbita.scheduler")

_scheduler: BackgroundScheduler | None = None

# Reintentos a nivel cliente ante fallos transitorios de ARCA (login/sesión/navegador). Es el
# backstop del sync diario: los fallos puntuales de UNA búsqueda ya los reintenta el scraper
# internamente (ver miscomprobantes.MAX_INTENTOS_BUSQUEDA); esto cubre cuando se cae la sesión
# entera. Backoff incremental antes de cada reintento.
SYNC_REINTENTOS = 2
SYNC_BACKOFF_SEG = (30, 90)


def _sincronizar_con_reintento(db, cuit: str) -> int:
    """Sincroniza un cliente reintentando ante fallos (cada fallo deja su fila en `extracciones`;
    el panel marca la falla como resuelta si un intento posterior sale bien). Propaga el último
    error si se agotan los intentos."""
    ultimo: Exception | None = None
    for intento in range(SYNC_REINTENTOS + 1):
        try:
            return sincronizar(db, cuit)
        except Exception as e:  # noqa: BLE001
            ultimo = e
            if intento < SYNC_REINTENTOS:
                espera = SYNC_BACKOFF_SEG[min(intento, len(SYNC_BACKOFF_SEG) - 1)]
                logger.warning(
                    "  %s falló (intento %d/%d), reintento en %ds: %s",
                    cuit, intento + 1, SYNC_REINTENTOS + 1, espera, e,
                )
                time.sleep(espera)
    raise ultimo  # type: ignore[misc]


def sincronizar_todos() -> dict[str, object]:
    """Sincroniza todos los clientes registrados. Un cliente que falla no frena al resto."""
    db = SessionLocal()
    resumen: dict[str, object] = {}
    try:
        cuits = list(db.scalars(select(models.ClienteARCA.cuit)).all())
        logger.info("sync de %d cliente(s)", len(cuits))
        for cuit in cuits:
            try:
                resumen[cuit] = _sincronizar_con_reintento(db, cuit)
                logger.info("  %s -> %s comprobantes", cuit, resumen[cuit])
            except Exception as e:  # noqa: BLE001
                resumen[cuit] = f"error: {e}"
                logger.warning("  %s FALLÓ tras reintentos: %s", cuit, e)
    finally:
        db.close()

    # Tras sincronizar, evaluá las alertas y notificá por WhatsApp (best-effort: no frena el sync).
    db_alertas = SessionLocal()
    try:
        res = evaluar_y_notificar(db_alertas)
        logger.info("alertas: %s", res)
    except Exception:  # noqa: BLE001
        logger.warning("evaluar_y_notificar falló", exc_info=True)
    finally:
        db_alertas.close()
    return resumen


def iniciar_scheduler(hora: int = 3) -> None:
    """Arranca el job diario (cron) a las `hora`:00, horario de Argentina."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="America/Argentina/Buenos_Aires")
    _scheduler.add_job(
        sincronizar_todos, "cron", hour=hora, minute=0, id="sync_diario", replace_existing=True
    )
    _scheduler.start()
    logger.info("scheduler iniciado: sync diario a las %02d:00 (AR)", hora)


def detener_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def estado_scheduler() -> dict[str, object]:
    """Estado del auto-sync: si corre y cuándo es el próximo disparo del job diario."""
    if _scheduler is None:
        return {"activo": False, "proximo_disparo": None}
    job = _scheduler.get_job("sync_diario")
    return {
        "activo": bool(_scheduler.running),
        "proximo_disparo": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }
