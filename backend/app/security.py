"""Seguridad de la sesión de contadores: hashing de contraseñas (bcrypt) y tokens JWT (PyJWT)."""
from __future__ import annotations

import datetime as dt

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .db import get_db

ALGORITMO = "HS256"
_bearer = HTTPBearer(auto_error=False)


def _secret() -> str:
    """Secreto para firmar/verificar los JWT. Cae a FERNET_KEY si no hay JWT_SECRET."""
    secret = settings.jwt_secret or settings.fernet_key
    if not secret:
        raise RuntimeError(
            "Falta JWT_SECRET (o FERNET_KEY) en backend/.env para firmar los tokens de sesión."
        )
    return secret


def hashear_password(password: str) -> str:
    # bcrypt opera sobre <= 72 bytes; truncamos por las dudas (el schema ya valida la longitud).
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verificar_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except ValueError:
        return False


def crear_token(usuario_id: int) -> str:
    ahora = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(usuario_id),
        "iat": ahora,
        "exp": ahora + dt.timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITMO)


def usuario_actual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.Usuario:
    """Dependencia FastAPI: valida el header `Authorization: Bearer <token>` y devuelve el
    contador logueado. Lanza 401 si el token falta, es inválido, expiró o el usuario no existe."""
    no_autorizado = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesión inválida o expirada.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if cred is None:
        raise no_autorizado
    try:
        payload = jwt.decode(cred.credentials, _secret(), algorithms=[ALGORITMO])
        usuario_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as e:
        raise no_autorizado from e
    usuario = db.get(models.Usuario, usuario_id)
    if usuario is None:
        raise no_autorizado
    return usuario
