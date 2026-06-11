"""Vista del motor de sincronización continua en el panel admin (tab Motor). Todo se deriva de la
DB (tabla `extracciones` + `clientes_arca`) más el latido que escribe el worker (`worker_heartbeat`),
porque el worker corre en otro proceso/contenedor. Sólo lectura. Protegido por `admin_actual`."""
from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..db import get_db
from ..schemas import MotorClienteOut, MotorEstadoOut
from ..security import admin_actual

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_actual)])

# El worker se considera "vivo" si latió hace menos de esto (3 polls + margen).
LATIDO_VIVO_SEG = max(180, settings.sync_poll_segundos * 3)


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    """SQLite (dev) devuelve fechas naive; Postgres (prod) aware. Normalizamos a UTC-aware para poder
    comparar/restar sin romper."""
    if d is not None and d.tzinfo is None:
        return d.replace(tzinfo=dt.timezone.utc)
    return d


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


def _horas_desde(d: dt.datetime | None, ahora: dt.datetime) -> float | None:
    d = _aware(d)
    if d is None:
        return None
    return round((ahora - d).total_seconds() / 3600, 1)


@router.get("/motor", response_model=MotorEstadoOut)
def estado_motor(db: Session = Depends(get_db)):
    ahora = dt.datetime.now(dt.timezone.utc)
    limite = ahora - dt.timedelta(hours=settings.sync_intervalo_horas)

    # Lookup cuit -> (nombre, email del contador) para enriquecer las listas.
    info = {
        cuit: (nombre, email)
        for cuit, nombre, email in db.execute(
            select(models.ClienteARCA.cuit, models.ClienteARCA.nombre, models.Usuario.email)
            .outerjoin(models.Usuario, models.Usuario.id == models.ClienteARCA.usuario_id)
        ).all()
    }

    def _cli(cuit, **extra) -> MotorClienteOut:
        nombre, email = info.get(cuit, (None, None))
        return MotorClienteOut(cuit=cuit, cliente=nombre, contador_email=email, **extra)

    # Última extracción por cliente (con su resultado) vía window function.
    rn = func.row_number().over(
        partition_by=models.Extraccion.cuit, order_by=models.Extraccion.fecha.desc()
    ).label("rn")
    sub = select(
        models.Extraccion.cuit,
        models.Extraccion.fecha,
        models.Extraccion.resultado,
        models.Extraccion.comprobantes,
        models.Extraccion.duracion_ms,
        rn,
    ).subquery()
    ultimas = {
        r.cuit: r for r in db.execute(select(sub).where(sub.c.rn == 1)).all()
    }

    # Cobertura: clasifico cada cliente según su última extracción.
    total = frescos = pendientes = nunca = con_falla = 0
    vencidos: list[tuple[dt.datetime | None, str]] = []
    for cuit in info:
        total += 1
        u = ultimas.get(cuit)
        if u is None:
            nunca += 1
            pendientes += 1
            vencidos.append((None, cuit))
            continue
        fecha = _aware(u.fecha)
        if fecha < limite:
            pendientes += 1
            vencidos.append((fecha, cuit))
        else:
            frescos += 1
        if u.resultado == "fallida":
            con_falla += 1

    # Próximos a sincronizar: más vencidos primero (los 'nunca' van primero).
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    vencidos.sort(key=lambda x: x[0] or epoch)
    proximos = [
        _cli(cuit, ultima=_iso(f), horas_desde=_horas_desde(f, ahora))
        for f, cuit in vencidos[:15]
    ]

    # Throughput.
    def _contar(desde: dt.datetime, resultado: str | None = None) -> int:
        q = select(func.count()).where(models.Extraccion.fecha >= desde)
        if resultado:
            q = q.where(models.Extraccion.resultado == resultado)
        return db.scalar(q) or 0

    hace_1h = ahora - dt.timedelta(hours=1)
    hace_24h = ahora - dt.timedelta(hours=24)

    # Actividad reciente (feed de las últimas extracciones).
    recientes = db.execute(
        select(models.Extraccion).order_by(models.Extraccion.fecha.desc()).limit(20)
    ).scalars().all()
    actividad = [
        _cli(
            e.cuit,
            ultima=_iso(e.fecha),
            horas_desde=_horas_desde(e.fecha, ahora),
            resultado=e.resultado,
            comprobantes=e.comprobantes,
            duracion_seg=round(e.duracion_ms / 1000) if e.duracion_ms else None,
        )
        for e in recientes
    ]

    # Latido del worker.
    hb = db.get(models.WorkerHeartbeat, 1)
    worker_vivo = False
    worker_actualizado = None
    en_vuelo: list[MotorClienteOut] = []
    concurrencia = settings.sync_worker_concurrencia
    intervalo = settings.sync_intervalo_horas
    if hb is not None:
        worker_actualizado = _iso(hb.actualizado_en)
        worker_vivo = (ahora - _aware(hb.actualizado_en)).total_seconds() < LATIDO_VIVO_SEG
        concurrencia = hb.concurrencia or concurrencia
        intervalo = hb.intervalo_horas or intervalo
        try:
            for cuit in json.loads(hb.en_vuelo or "[]"):
                u = ultimas.get(cuit)
                en_vuelo.append(_cli(cuit, ultima=_iso(u.fecha) if u else None))
        except (ValueError, TypeError):
            pass

    return MotorEstadoOut(
        worker_vivo=worker_vivo,
        worker_actualizado=worker_actualizado,
        en_vuelo=en_vuelo,
        concurrencia=concurrencia,
        intervalo_horas=intervalo,
        total_clientes=total,
        frescos=frescos,
        pendientes=pendientes,
        nunca=nunca,
        con_falla_actual=con_falla,
        syncs_1h=_contar(hace_1h),
        syncs_24h=_contar(hace_24h),
        exitosas_24h=_contar(hace_24h, "exitosa"),
        fallidas_24h=_contar(hace_24h, "fallida"),
        proximos=proximos,
        actividad=actividad,
    )
