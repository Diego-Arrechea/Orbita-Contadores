"""Auth de contadores: registro (alta + auto-login), login y /me."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..db import get_db
from ..schemas import (
    AuthOut,
    CambioPasswordIn,
    ConfirmarEmailIn,
    LoginIn,
    RecuperarIn,
    RegistroIn,
    RestablecerIn,
    UsuarioOut,
    dias_restantes_trial,
)
from ..security import (
    crear_token,
    generar_email_token,
    generar_reset_token,
    hashear_email_token,
    hashear_password,
    hashear_reset_token,
    usuario_actual,
    verificar_password,
)
from ..services import crisp, email

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Duración del período de prueba gratis para cada cuenta nueva.
TRIAL_DIAS = 30


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
        email_confirmado=bool(u.email_confirmado),
        trial_fin=u.trial_fin.isoformat() if u.trial_fin else None,
        trial_dias_restantes=dias_restantes_trial(u.trial_fin),
    )


def _auth_out(usuario: models.Usuario) -> AuthOut:
    return AuthOut(token=crear_token(usuario.id), usuario=_usuario_out(usuario))


@router.post("/registro", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def registrar(datos: RegistroIn, db: Session = Depends(get_db)):
    """Da de alta un contador y lo deja logueado (devuelve token). Email y CUIT son únicos."""
    # Ojo: NO usar `email` como nombre local (taparía el módulo `email` que mandamos el correo abajo).
    correo = datos.email.lower()
    if db.scalar(select(models.Usuario).where(models.Usuario.email == correo)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese email.")
    if db.scalar(select(models.Usuario).where(models.Usuario.cuit == datos.cuit)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con ese CUIT.")

    ahora = dt.datetime.now(dt.timezone.utc)
    # Token de confirmación de email (single-use): se guarda hasheado y el claro viaja en el enlace.
    confirm_token, confirm_hash = generar_email_token()
    usuario = models.Usuario(
        nombre=datos.nombre.strip(),
        apellido=datos.apellido.strip(),
        email=correo,
        telefono=datos.telefono.strip(),
        dni=datos.dni,
        cuit=datos.cuit,
        estudio=datos.estudio.strip(),
        matricula=(datos.matricula or "").strip() or None,
        password_hash=hashear_password(datos.password),
        acepto_terminos=datos.acepto_terminos,
        # El registro ya deja al contador logueado (devuelve token): contamos eso como su primer
        # acceso, si no la cuenta figura como "nunca entró" hasta que pase por la pantalla de login.
        ultimo_acceso=ahora,
        # Período de prueba gratis de 30 días desde el alta.
        trial_fin=ahora + dt.timedelta(days=TRIAL_DIAS),
        # Confirmación de email pendiente (enforcement suave: igual queda logueado).
        email_confirmado=False,
        email_token_hash=confirm_hash,
        email_token_exp=ahora + dt.timedelta(hours=settings.email_confirm_token_horas),
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
    email.enviar_link_confirmacion(usuario, confirm_token)  # no-op si SMTP no está configurado
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


@router.post("/cambiar-password")
def cambiar_password(
    datos: CambioPasswordIn,
    usuario: models.Usuario = Depends(usuario_actual),
    db: Session = Depends(get_db),
):
    """Cambia la contraseña del contador logueado. Exige la contraseña actual (re-autenticación)."""
    if not verificar_password(datos.password_actual, usuario.password_hash):
        raise HTTPException(status_code=401, detail="La contraseña actual no es correcta.")
    usuario.password_hash = hashear_password(datos.password_nueva)
    db.commit()
    return {"ok": True}


@router.post("/recuperar")
def recuperar(datos: RecuperarIn, db: Session = Depends(get_db)):
    """Inicia la recuperación de contraseña. Responde SIEMPRE 200 con un mensaje genérico, exista o
    no el email (no revelamos qué cuentas existen). Si la cuenta existe y está activa, genera un
    token de un solo uso, lo guarda hasheado y manda el enlace por correo (best-effort)."""
    usuario = db.scalar(
        select(models.Usuario).where(models.Usuario.email == datos.email.lower())
    )
    if usuario is not None and usuario.activo:
        token, token_hash = generar_reset_token()
        usuario.reset_token_hash = token_hash
        usuario.reset_token_exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
            hours=settings.reset_token_horas
        )
        db.commit()
        email.enviar_link_reset(usuario, token)  # no-op si SMTP no está configurado
    return {
        "mensaje": "Si el correo está registrado, te enviamos las instrucciones para "
        "restablecer tu contraseña."
    }


@router.post("/restablecer")
def restablecer(datos: RestablecerIn, db: Session = Depends(get_db)):
    """Confirma el reset: valida el token del enlace (existe + no venció) y fija la contraseña nueva.
    El token es de un solo uso: se limpia al usarlo."""
    invalido = HTTPException(
        status_code=400, detail="El enlace no es válido o ya expiró. Pedí uno nuevo."
    )
    if not datos.token:
        raise invalido
    usuario = db.scalar(
        select(models.Usuario).where(
            models.Usuario.reset_token_hash == hashear_reset_token(datos.token)
        )
    )
    if usuario is None or usuario.reset_token_exp is None:
        raise invalido
    # reset_token_exp puede venir naive de SQLite: lo normalizamos a UTC para comparar.
    exp = usuario.reset_token_exp
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=dt.timezone.utc)
    if exp <= dt.datetime.now(dt.timezone.utc):
        raise invalido
    usuario.password_hash = hashear_password(datos.password_nueva)
    usuario.reset_token_hash = None
    usuario.reset_token_exp = None
    db.commit()
    return {"ok": True}


@router.post("/confirmar-email")
def confirmar_email(datos: ConfirmarEmailIn, db: Session = Depends(get_db)):
    """Confirma el email del contador: valida el token del enlace (existe + no venció) y marca la
    cuenta como confirmada. El token es de un solo uso: se limpia al usarlo. Endpoint público (el
    contador puede abrir el enlace sin sesión, incluso desde otro dispositivo)."""
    invalido = HTTPException(
        status_code=400, detail="El enlace no es válido o ya expiró. Pedí uno nuevo."
    )
    if not datos.token:
        raise invalido
    usuario = db.scalar(
        select(models.Usuario).where(
            models.Usuario.email_token_hash == hashear_email_token(datos.token)
        )
    )
    if usuario is None or usuario.email_token_exp is None:
        raise invalido
    # email_token_exp puede venir naive de SQLite: lo normalizamos a UTC para comparar.
    exp = usuario.email_token_exp
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=dt.timezone.utc)
    if exp <= dt.datetime.now(dt.timezone.utc):
        raise invalido
    usuario.email_confirmado = True
    usuario.email_token_hash = None
    usuario.email_token_exp = None
    db.commit()
    return {"ok": True}


@router.post("/reenviar-confirmacion")
def reenviar_confirmacion(
    usuario: models.Usuario = Depends(usuario_actual),
    db: Session = Depends(get_db),
):
    """Reenvía el correo de confirmación al contador logueado (botón del banner). Regenera el token
    (invalida el anterior) y manda el enlace de nuevo. Si ya está confirmado, no hace nada."""
    if usuario.email_confirmado:
        return {"ok": True, "ya_confirmado": True}
    token, token_hash = generar_email_token()
    usuario.email_token_hash = token_hash
    usuario.email_token_exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(
        hours=settings.email_confirm_token_horas
    )
    db.commit()
    email.enviar_link_confirmacion(usuario, token)  # no-op si SMTP no está configurado
    return {"ok": True}
