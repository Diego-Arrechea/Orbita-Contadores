"""Seguridad de la sesión de contadores: hashing de contraseñas (bcrypt) y tokens JWT (PyJWT)."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .config import facturacion_habilitada_para, settings
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


def hashear_reset_token(token: str) -> str:
    """sha256 (hex) del token de recuperación. En la DB guardamos sólo este hash, nunca el token
    en claro: así una filtración de la base no permite restablecer contraseñas."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generar_reset_token() -> tuple[str, str]:
    """Token de recuperación de un solo uso. Devuelve (token_claro, token_hash): el claro viaja en
    el enlace del email; el hash se persiste en `Usuario.reset_token_hash`."""
    token = secrets.token_urlsafe(32)
    return token, hashear_reset_token(token)


def hashear_email_token(token: str) -> str:
    """sha256 (hex) del token de confirmación de email. Mismo criterio que el de reset: en la DB
    guardamos sólo este hash, nunca el token en claro."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generar_email_token() -> tuple[str, str]:
    """Token de confirmación de email de un solo uso. Devuelve (token_claro, token_hash): el claro
    viaja en el enlace del correo; el hash se persiste en `Usuario.email_token_hash`."""
    token = secrets.token_urlsafe(32)
    return token, hashear_email_token(token)


def generar_password_temporal() -> str:
    """Contraseña temporal legible para el reset desde el panel admin (cumple el mínimo de 8)."""
    return secrets.token_urlsafe(9)


def crear_token(usuario_id: int, imp_admin: bool = False) -> str:
    ahora = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(usuario_id),
        "iat": ahora,
        "exp": ahora + dt.timedelta(minutes=settings.jwt_expire_minutes),
    }
    # 'adm' = la sesión es una impersonación hecha por un ADMIN: lleva su privilegio (p. ej. facturar
    # para probar en cualquier cliente), aunque el contador impersonado no esté habilitado.
    if imp_admin:
        payload["adm"] = True
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
    if not usuario.activo:
        # Cuenta inhabilitada por un administrador: corta la sesión aunque el token siga vigente.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta está inhabilitada. Escribinos para reactivarla.",
        )
    # Marca transitoria (no se persiste): la sesión es una impersonación hecha por un admin.
    usuario._imp_admin = bool(payload.get("adm"))  # type: ignore[attr-defined]
    return usuario


def usuario_puede_facturar(usuario: models.Usuario) -> bool:
    """¿Puede emitir comprobantes? Habilitados por FACTURACION_EMAILS + admins + impersonación de
    admin (claim 'adm' del token). Pensado para que un admin pueda probar facturando en cualquier
    cliente al 'entrar como', sin habilitar a los contadores reales."""
    return facturacion_habilitada_para(usuario.email, usuario.rol) or bool(
        getattr(usuario, "_imp_admin", False)
    )


def admin_actual(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: exige que el usuario logueado sea administrador (panel superadmin).
    Reusa `usuario_actual` (token válido + cuenta activa) y además chequea el rol."""
    if usuario.rol != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para acceder a esta sección.",
        )
    return usuario
