"""Seguridad de la sesión de contadores: hashing de contraseñas (bcrypt), tokens JWT (PyJWT) y
equipo del estudio (visibilidad por responsable + permisos de empleados)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .config import facturacion_habilitada_para, iva_habilitada_para, settings
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
            detail=(
                "Tu cuenta fue deshabilitada. Escribinos a orbitaglobalclientes@gmail.com "
                "para reactivarla."
            ),
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


def usuario_puede_iva(usuario: models.Usuario) -> bool:
    """¿Puede ver el apartado de IVA? Habilitados por IVA_EMAILS + admins + impersonación de admin
    (claim 'adm' del token, para que un admin pueda testear en cualquier cuenta al 'entrar como').
    Espeja usuario_puede_facturar."""
    return iva_habilitada_para(usuario.email, usuario.rol) or bool(
        getattr(usuario, "_imp_admin", False)
    )


def usuario_iva(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: como `usuario_actual`, pero además exige que la cuenta tenga habilitado el
    apartado de IVA (403 si no). Cierra los endpoints de IVA por detrás del gate del front."""
    if not usuario_puede_iva(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés habilitado el apartado de IVA.",
        )
    return usuario


def admin_actual(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: exige que el usuario logueado sea administrador (panel superadmin).
    Reusa `usuario_actual` (token válido + cuenta activa) y además chequea el rol."""
    if usuario.rol != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para acceder a esta sección.",
        )
    return usuario


# --- Equipo del estudio ("Gestión de usuarios") --------------------------------------------------
# El titular crea cuentas de EMPLEADO (Usuario.titular_id = su id) y les asigna clientes: cada
# cliente sigue teniendo UN responsable (ClienteARCA.usuario_id). El empleado ve/opera sólo sus
# asignados; el titular ve toda la cartera del equipo. Los permisos acotan qué ACCIONES puede hacer
# el empleado sobre sus asignados (se enforcan acá, no sólo en el front).

# Permisos disponibles para empleados (clave → descripción para devs; los labels de UI viven en el
# front). Default: TODOS habilitados; el titular los apaga por empleado (Usuario.permisos_json).
PERMISOS_EQUIPO = (
    "nuevo_cliente",      # dar de alta clientes (quedan asignados a él)
    "editar_cliente",     # editar la ficha (notas, categoría manual, pausar/reactivar)
    "eliminar_cliente",   # borrar un cliente y su historial
    "actualizar_clave",   # reemplazar la clave con la que se consultan los datos del cliente
    "facturar",           # emitir comprobantes (se suma al gate general de facturación)
    "conciliacion",       # importar extractos y clasificar movimientos
    "comunicaciones",     # abrir el detalle de comunicaciones fiscales (las marca leídas en ARCA)
)


def es_empleado(usuario: models.Usuario) -> bool:
    """¿La cuenta es un empleado creado desde "Gestión de usuarios"? (ve sólo sus asignados)."""
    return usuario.titular_id is not None


def permisos_efectivos(usuario: models.Usuario) -> dict[str, bool]:
    """Permisos del usuario con los defaults aplicados (clave ausente = habilitado). Para cuentas
    plenas (no-empleado) devuelve todo en True."""
    guardado: dict = {}
    if es_empleado(usuario) and usuario.permisos_json:
        try:
            guardado = json.loads(usuario.permisos_json)
        except ValueError:
            guardado = {}
    return {clave: bool(guardado.get(clave, True)) for clave in PERMISOS_EQUIPO}


def tiene_permiso(usuario: models.Usuario, clave: str) -> bool:
    if not es_empleado(usuario):
        return True
    return permisos_efectivos(usuario).get(clave, True)


def requiere_permiso(clave: str):
    """Fábrica de dependencias FastAPI: como `usuario_actual`, pero además exige el permiso `clave`
    (403 si el titular se lo apagó al empleado). Para cuentas plenas es transparente."""

    def _dep(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
        if not tiene_permiso(usuario, clave):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu cuenta no tiene habilitada esta función. Pedile al titular del "
                "estudio que la active.",
            )
        return usuario

    return _dep


def titular_actual(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: exige una cuenta PLENA (no empleado) para administrar el equipo
    ("Gestión de usuarios"). Cualquier contador puede crear su equipo; un empleado no."""
    if es_empleado(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para acceder a esta sección.",
        )
    return usuario


def ids_cartera(db: Session, usuario: models.Usuario) -> list[int]:
    """Los `usuario_id` cuyos clientes puede ver esta cuenta: los propios y, si tiene equipo, los de
    todos sus empleados (incluidos los desactivados: sus clientes no desaparecen de la vista del
    titular). Para un empleado o un contador sin equipo devuelve sólo su id."""
    ids = [usuario.id]
    if not es_empleado(usuario):
        ids += list(
            db.scalars(select(models.Usuario.id).where(models.Usuario.titular_id == usuario.id))
        )
    return ids
