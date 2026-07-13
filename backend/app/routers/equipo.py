"""Gestión de usuarios del estudio: el titular crea cuentas de EMPLEADO, les prende/apaga permisos
y les asigna clientes. Cada cliente tiene UN responsable (ClienteARCA.usuario_id): el empleado ve y
opera sólo sus asignados; el titular ve toda la cartera del equipo (ver security.ids_cartera).

Todo el router exige una cuenta PLENA (titular_actual): un empleado no puede administrar el equipo
ni crear otros usuarios. El alta siempre fuerza rol='contador' y titular_id=el titular logueado, así
que desde acá no se pueden crear admins ni titulares."""
from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import AsignarClienteIn, MiembroIn, MiembroOut, MiembroPatch
from ..security import (
    PERMISOS_EQUIPO,
    hashear_password,
    permisos_efectivos,
    titular_actual,
)

router = APIRouter(prefix="/api/equipo", tags=["equipo"])


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


def _miembro_propio(db: Session, miembro_id: int, titular: models.Usuario) -> models.Usuario:
    """Devuelve el miembro sólo si es un empleado de ESTE titular; si no, 404 (sin revelar que
    existe). Bloquea operar sobre cuentas ajenas, sobre uno mismo o sobre otros titulares."""
    miembro = db.get(models.Usuario, miembro_id)
    if miembro is None or miembro.titular_id != titular.id:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return miembro


def _normalizar_permisos(permisos: dict | None) -> str | None:
    """Filtra claves desconocidas y descarta el JSON si quedó todo en default (todos habilitados)."""
    if not permisos:
        return None
    limpio = {k: bool(v) for k, v in permisos.items() if k in PERMISOS_EQUIPO}
    if not limpio or all(limpio.get(k, True) for k in PERMISOS_EQUIPO):
        return None
    return json.dumps(limpio)


def _miembro_out(db: Session, u: models.Usuario, clientes: int | None = None) -> MiembroOut:
    if clientes is None:
        clientes = (
            db.scalar(
                select(func.count())
                .select_from(models.ClienteARCA)
                .where(models.ClienteARCA.usuario_id == u.id)
            )
            or 0
        )
    return MiembroOut(
        id=u.id,
        nombre=u.nombre,
        apellido=u.apellido,
        email=u.email,
        activo=bool(u.activo),
        permisos=permisos_efectivos(u),
        clientes=clientes,
        creado_en=_iso(u.creado_en),
        ultimo_acceso=_iso(u.ultimo_acceso),
    )


@router.get("/miembros", response_model=list[MiembroOut])
def listar_miembros(
    db: Session = Depends(get_db), titular: models.Usuario = Depends(titular_actual)
):
    """Los usuarios del equipo del titular, con cuántos clientes tiene asignados cada uno."""
    miembros = db.scalars(
        select(models.Usuario)
        .where(models.Usuario.titular_id == titular.id)
        .order_by(models.Usuario.creado_en)
    ).all()
    conteos = dict(
        db.execute(
            select(models.ClienteARCA.usuario_id, func.count())
            .where(models.ClienteARCA.usuario_id.in_([m.id for m in miembros] or [0]))
            .group_by(models.ClienteARCA.usuario_id)
        ).all()
    )
    return [_miembro_out(db, m, conteos.get(m.id, 0)) for m in miembros]


@router.post("/miembros", response_model=MiembroOut, status_code=201)
def crear_miembro(
    datos: MiembroIn,
    db: Session = Depends(get_db),
    titular: models.Usuario = Depends(titular_actual),
):
    """Crea la cuenta de un usuario del equipo. Entra con email + la contraseña que fija el titular;
    hereda el nombre del estudio. Sin CUIT/DNI (cuenta interna). El email queda confirmado (la
    cuenta la creó el titular; no le pedimos el ritual del enlace)."""
    correo = datos.email.lower()
    if db.scalar(select(models.Usuario).where(models.Usuario.email == correo)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email.")
    miembro = models.Usuario(
        nombre=datos.nombre.strip(),
        apellido=datos.apellido.strip(),
        email=correo,
        telefono="",
        dni="",
        cuit=None,
        estudio=titular.estudio,
        password_hash=hashear_password(datos.password),
        acepto_terminos=True,
        email_confirmado=True,
        rol="contador",
        titular_id=titular.id,
        permisos_json=_normalizar_permisos(datos.permisos),
    )
    db.add(miembro)
    try:
        db.commit()
    except IntegrityError as e:  # carrera: alguien registró el mismo email en paralelo
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email.") from e
    db.refresh(miembro)
    return _miembro_out(db, miembro, 0)


@router.patch("/miembros/{miembro_id}", response_model=MiembroOut)
def editar_miembro(
    miembro_id: int,
    cambios: MiembroPatch,
    db: Session = Depends(get_db),
    titular: models.Usuario = Depends(titular_actual),
):
    """Activa/desactiva la cuenta, actualiza sus permisos o le fija una contraseña nueva.
    Desactivado: el empleado no puede iniciar sesión ni operar (mismo corte que el panel admin);
    sus clientes asignados NO se tocan y siguen visibles para el titular."""
    miembro = _miembro_propio(db, miembro_id, titular)
    if cambios.activo is not None:
        miembro.activo = cambios.activo
    if cambios.permisos is not None:
        # PATCH parcial sobre los efectivos: lo que no vino conserva su valor actual.
        actuales = permisos_efectivos(miembro)
        actuales.update({k: bool(v) for k, v in cambios.permisos.items() if k in PERMISOS_EQUIPO})
        miembro.permisos_json = _normalizar_permisos(actuales)
    if cambios.password is not None:
        miembro.password_hash = hashear_password(cambios.password)
    db.commit()
    db.refresh(miembro)
    return _miembro_out(db, miembro)


@router.delete("/miembros/{miembro_id}")
def eliminar_miembro(
    miembro_id: int,
    db: Session = Depends(get_db),
    titular: models.Usuario = Depends(titular_actual),
):
    """Elimina la cuenta del miembro. Sus clientes asignados NO se pierden: pasan al titular (que ya
    los veía). Se limpia su registro de alertas (FK) antes de borrar la cuenta."""
    miembro = _miembro_propio(db, miembro_id, titular)
    reasignados = db.execute(
        update(models.ClienteARCA)
        .where(models.ClienteARCA.usuario_id == miembro.id)
        .values(usuario_id=titular.id)
    ).rowcount
    db.execute(
        delete(models.AlertaEnviada).where(models.AlertaEnviada.usuario_id == miembro.id)
    )
    db.delete(miembro)
    db.commit()
    return {"ok": True, "clientes_reasignados": reasignados}


@router.put("/clientes/{cuit}/asignar")
def asignar_cliente(
    cuit: str,
    datos: AsignarClienteIn,
    db: Session = Depends(get_db),
    titular: models.Usuario = Depends(titular_actual),
):
    """Cambia el responsable de un cliente dentro del equipo: al propio titular o a uno de sus
    empleados. Sólo mueve la asignación (quién lo ve/opera); los datos del cliente no se tocan."""
    cliente = db.get(models.ClienteARCA, cuit)
    equipo = {titular.id} | set(
        db.scalars(select(models.Usuario.id).where(models.Usuario.titular_id == titular.id))
    )
    if cliente is None or cliente.usuario_id not in equipo:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    if datos.usuario_id not in equipo:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    cliente.usuario_id = datos.usuario_id
    db.commit()
    return {"ok": True, "cuit": cuit, "usuario_id": datos.usuario_id}
