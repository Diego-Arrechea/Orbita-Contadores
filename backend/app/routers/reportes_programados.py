"""Envíos programados del reporte por mail: crear, listar, pausar/reanudar y borrar. El envío lo hace
el worker (services/reportes_programados.procesar_pendientes). Cada cuenta ve y maneja las suyas."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import bloquear_si_demo, usuario_actual, usuario_puede
from ..services import reporte_auto
from ..services import reportes_programados as svc
from .clientes import _cliente_propio

router = APIRouter(prefix="/api", tags=["reportes-programados"])


class DestinoIn(BaseModel):
    cuit: str = Field(max_length=13)
    destino: str = Field(max_length=200)


class ProgramacionIn(BaseModel):
    frecuencia: str
    hora: str
    fecha: str | None = None
    dia_mes: int | None = None
    dia_semana: int | None = None
    destinos: list[DestinoIn] = Field(max_length=svc.MAX_CLIENTES)
    mensaje: str = Field("", max_length=4000)
    copia_a_mi: bool = True


class EstadoIn(BaseModel):
    activo: bool


def _propia(db: Session, id_: int, usuario: models.Usuario) -> models.ReporteProgramado:
    p = db.get(models.ReporteProgramado, id_)
    if p is None or p.usuario_id != usuario.id:
        raise HTTPException(status_code=404, detail="No se encontró el envío programado.")
    return p


@router.get("/reportes-programados")
def listar(db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)):
    filas = db.scalars(
        select(models.ReporteProgramado)
        .where(models.ReporteProgramado.usuario_id == usuario.id)
        .order_by(models.ReporteProgramado.activo.desc(), models.ReporteProgramado.proximo_envio)
    ).all()
    return [svc.serializar(db, p) for p in filas]


@router.post("/reportes-programados")
def crear(
    datos: ProgramacionIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    bloquear_si_demo(db, usuario, "Los reportes de clientes de ejemplo no se envían por mail.")
    try:
        campos = svc.validar(db, usuario, datos.model_dump(mode="python"))
    except svc.ProgramacionInvalida as e:
        raise HTTPException(status_code=422, detail=str(e))
    p = models.ReporteProgramado(usuario_id=usuario.id, activo=True, **campos)
    db.add(p)
    db.commit()
    db.refresh(p)
    return svc.serializar(db, p)


@router.put("/reportes-programados/{id_}")
def editar(
    id_: int,
    datos: ProgramacionIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    p = _propia(db, id_, usuario)
    try:
        campos = svc.validar(db, usuario, datos.model_dump(mode="python"))
    except svc.ProgramacionInvalida as e:
        raise HTTPException(status_code=422, detail=str(e))
    for k, v in campos.items():
        setattr(p, k, v)
    p.activo = True
    db.commit()
    return svc.serializar(db, p)


@router.put("/reportes-programados/{id_}/estado")
def cambiar_estado(
    id_: int,
    datos: EstadoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Pausar o reanudar. Al reanudar se recalcula el próximo envío desde ahora (un único que ya pasó
    no se puede reanudar)."""
    p = _propia(db, id_, usuario)
    if datos.activo:
        proximo = svc.proximo_envio(
            frecuencia=p.frecuencia, hora=p.hora, fecha=p.fecha, dia_mes=p.dia_mes,
            dia_semana=p.dia_semana, despues=dt.datetime.now(dt.timezone.utc),
        )
        if proximo is None:
            raise HTTPException(status_code=422, detail="La fecha y hora del envío ya pasaron.")
        p.proximo_envio = proximo
    p.activo = datos.activo
    db.commit()
    return svc.serializar(db, p)


@router.delete("/reportes-programados/{id_}")
def borrar(id_: int, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)):
    p = _propia(db, id_, usuario)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/clientes/{cuit}/reporte/vista-previa")
def vista_previa(
    cuit: str,
    mensaje: str = "",
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """El mail tal como lo armaría hoy un envío programado (mismo armado que el worker)."""
    cliente = _cliente_propio(db, cuit, usuario)
    return reporte_auto.armar_reporte(
        db, usuario, cliente,
        observaciones=mensaje[:4000],
        estudio=usuario.estudio or "Tu estudio contable",
        incluir_movimientos=usuario_puede(db, usuario, "conciliacion"),
    )
