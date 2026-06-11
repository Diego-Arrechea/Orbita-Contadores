"""Auth de contadores: registro (alta + auto-login), login y /me."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import AuthOut, LoginIn, RegistroIn, UsuarioOut
from ..security import crear_token, hashear_password, usuario_actual, verificar_password
from ..services import crisp

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _usuario_out(u: models.Usuario) -> UsuarioOut:
    return UsuarioOut(
        id=u.id,
        nombre=u.nombre,
        apellido=u.apellido,
        email=u.email,
        telefono=u.telefono,
        dni=u.dni,
        cuit=u.cuit,
        estudio=u.estudio,
        matricula=u.matricula,
        rol=u.rol,
    )


def _auth_out(usuario: models.Usuario) -> AuthOut:
    return AuthOut(token=crear_token(usuario.id), usuario=_usuario_out(usuario))


@router.post("/registro", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def registrar(datos: RegistroIn, db: Session = Depends(get_db)):
    """Da de alta un contador y lo deja logueado (devuelve token). Email y CUIT son únicos."""
    email = datos.email.lower()
    if db.scalar(select(models.Usuario).where(models.Usuario.email == email)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email.")
    if db.scalar(select(models.Usuario).where(models.Usuario.cuit == datos.cuit)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese CUIT.")

    usuario = models.Usuario(
        nombre=datos.nombre.strip(),
        apellido=datos.apellido.strip(),
        email=email,
        telefono=datos.telefono.strip(),
        dni=datos.dni,
        cuit=datos.cuit,
        estudio=datos.estudio.strip(),
        matricula=(datos.matricula or "").strip() or None,
        password_hash=hashear_password(datos.password),
        acepto_terminos=datos.acepto_terminos,
        # El registro ya deja al contador logueado (devuelve token): contamos eso como su primer
        # acceso, si no la cuenta figura como "nunca entró" hasta que pase por la pantalla de login.
        ultimo_acceso=dt.datetime.now(dt.timezone.utc),
    )
    db.add(usuario)
    try:
        db.commit()
    except IntegrityError as e:  # carrera: alguien registró el mismo email/CUIT en paralelo
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Ya existe una cuenta con ese email o CUIT."
        ) from e
    db.refresh(usuario)
    crisp.intentar_sincronizar(usuario)  # crea el contacto en Crisp (best-effort: no rompe el alta)
    return _auth_out(usuario)


@router.post("/login", response_model=AuthOut)
def login(datos: LoginIn, db: Session = Depends(get_db)):
    usuario = db.scalar(
        select(models.Usuario).where(models.Usuario.email == datos.email.lower())
    )
    if usuario is None or not verificar_password(datos.password, usuario.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos.")
    if not usuario.activo:
        raise HTTPException(
            status_code=403, detail="Tu cuenta está inhabilitada. Escribinos para reactivarla."
        )
    usuario.ultimo_acceso = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return _auth_out(usuario)


@router.get("/me", response_model=UsuarioOut)
def me(usuario: models.Usuario = Depends(usuario_actual)):
    """Devuelve el contador logueado (sirve para rehidratar la sesión en el front)."""
    return _usuario_out(usuario)
